// =====================================================
// FINAL CLASS MANAGEMENT API ENDPOINTS
// =====================================================
// Based on detailed requirements discussion
// Handles all class management, enrollment, and attendance features

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
const crypto = require('crypto');
require('dotenv').config({ path: '.env.local' });

const router = express.Router();

// Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// =====================================================
// CLASS INSTANCE MANAGEMENT
// =====================================================

// Create a new class instance
router.post('/api/class-instances', async (req, res) => {
  try {
    const { 
      course_id, 
      professor_id, 
      academic_period_id, 
      days_of_week, 
      start_time, 
      end_time,
      first_class_date,
      last_class_date,
      room_location,
      max_students 
    } = req.body;
    
    console.log('📚 Creating new class instance:', { 
      course_id, professor_id, academic_period_id, days_of_week 
    });
    
    // Get the next section number for this course and academic period
    const { data: existingClasses, error: countError } = await supabase
      .from('class_instances')
      .select('section_number')
      .eq('course_id', course_id)
      .eq('academic_period_id', academic_period_id)
      .order('section_number', { ascending: false })
      .limit(1);
    
    if (countError) throw countError;
    
    const nextSectionNumber = existingClasses && existingClasses.length > 0 
      ? existingClasses[0].section_number + 1 
      : 1;

    console.log('📊 Next section number:', nextSectionNumber);

    // Generate a unique class code
    const generateClassCode = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    const classCode = generateClassCode();
    console.log('🔑 Generated class code:', classCode);

    // Calculate enrollment deadline (2 weeks from first class date)
    const enrollmentDeadline = new Date(first_class_date);
    enrollmentDeadline.setDate(enrollmentDeadline.getDate() + 14);
    console.log('📅 Enrollment deadline:', enrollmentDeadline.toISOString().split('T')[0]);

    // Create class instance
    const { data: classInstance, error: createError } = await supabase
      .from('class_instances')
      .insert({
        course_id,
        professor_id,
        academic_period_id,
        section_number: nextSectionNumber,
        class_code: classCode,
        days_of_week,
        start_time,
        end_time,
        first_class_date,
        last_class_date,
        room_location,
        max_students: max_students || 30,
        enrollment_deadline: enrollmentDeadline.toISOString().split('T')[0]
      })
      .select(`
        *,
        courses(code, name, description, credits),
        academic_periods(name, year, semester)
      `)
      .single();
    
    if (createError) throw createError;
    
    // Generate class sessions automatically using our session management API
    try {
      const { generateSessionTemplates } = require('./session-management-api.js');
      await generateSessionTemplates(classInstance.id);
      console.log('✅ Session templates generated successfully');
    } catch (sessionError) {
      console.error('⚠️ Warning: Could not generate session templates:', sessionError);
      // Don't fail the request, just log the error
    }
    
    console.log('✅ Class instance created successfully:', classInstance.id);
    
    // Create corresponding class record for bulk enrollment compatibility
    try {
      const { data: course, error: courseError } = await supabase
        .from('courses')
        .select('code, name, description, credits, department_id')
        .eq('id', course_id)
        .single();
      
      if (!courseError && course) {
        const { data: newClass, error: classError } = await supabase
          .from('classes')
          .insert({
            code: course.code,
            name: course.name,
            description: course.description,
            credits: course.credits,
            professor_id,
            department_id: course.department_id,
            academic_period_id,
            room_location,
            max_students: max_students || 30,
            is_active: true
          })
          .select()
          .single();
        
        if (classError) {
          console.error('⚠️ Warning: Could not create corresponding class record:', classError);
        } else {
          console.log('✅ Corresponding class record created:', newClass.id);
        }
      }
    } catch (syncError) {
      console.error('⚠️ Warning: Could not sync class record:', syncError);
    }
    
    res.json({
      success: true,
      class_instance: classInstance
    });
    
  } catch (error) {
    console.error('❌ Class instance creation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get class instances for a professor
router.get('/api/professors/:professorId/class-instances', async (req, res) => {
  try {
    const { professorId } = req.params;
    const { period_id, include_sessions } = req.query;
    
    let query = supabase
      .from('class_instances')
      .select(`
        *,
        courses(code, name, description, credits, departments(name, code)),
        academic_periods(name, year, semester)
      `)
      .eq('professor_id', professorId);
    
    if (period_id) {
      query = query.eq('academic_period_id', period_id);
    }
    
    const { data: classInstances, error } = await query.order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Get enrollment counts and session info
    const classInstancesWithDetails = await Promise.all(
      classInstances.map(async (instance) => {
        // Get enrollment count
        const { data: enrollments } = await supabase
          .from('enrollments')
          .select('id')
          .eq('class_instance_id', instance.id)
          .eq('status', 'active');
        
        // Get session counts if requested
        let sessionInfo = {};
        if (include_sessions === 'true') {
          const { data: sessions } = await supabase
            .from('class_sessions')
            .select('id, status, date')
            .eq('class_instance_id', instance.id);
          
          sessionInfo = {
            total_sessions: sessions.length,
            completed_sessions: sessions.filter(s => s.status === 'completed').length,
            cancelled_sessions: sessions.filter(s => s.status === 'cancelled').length,
            upcoming_sessions: sessions.filter(s => s.status === 'scheduled' && s.date >= new Date().toISOString().split('T')[0]).length
          };
        }
        
        return {
          ...instance,
          current_enrollment: enrollments.length,
          capacity_percentage: instance.max_students > 0 
            ? Math.round((enrollments.length / instance.max_students) * 100) 
            : 0,
          ...sessionInfo
        };
      })
    );
    
    res.json({
      success: true,
      data: classInstancesWithDetails,
      count: classInstancesWithDetails.length
    });
    
  } catch (error) {
    console.error('Error fetching class instances:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get specific class instance with full details
router.get('/api/class-instances/:instanceId', async (req, res) => {
  try {
    const { instanceId } = req.params;
    
    // Get class instance details
    const { data: classInstance, error: instanceError } = await supabase
      .from('class_instances')
      .select(`
        *,
        courses(code, name, description, credits),
        academic_periods(name, year, semester),
        departments(name, code)
      `)
      .eq('id', instanceId)
      .single();
    
    if (instanceError) throw instanceError;
    
    // Get enrolled students
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select(`
        *,
        students!inner(
          student_id,
          users!inner(first_name, last_name, email)
        )
      `)
      .eq('class_instance_id', instanceId)
      .eq('status', 'active');
    
    // Get sessions
    const { data: sessions } = await supabase
      .from('class_sessions')
      .select('*')
      .eq('class_instance_id', instanceId)
      .order('date', { ascending: true });
    
    res.json({
      success: true,
      class_instance: {
        ...classInstance,
        enrollments: enrollments || [],
        sessions: sessions || []
      }
    });
    
  } catch (error) {
    console.error('Error fetching class instance details:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update class instance (for modifying sessions, etc.)
router.put('/api/class-instances/:instanceId', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const updateData = req.body;
    
    const { data, error } = await supabase
      .from('class_instances')
      .update(updateData)
      .eq('id', instanceId)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({
      success: true,
      class_instance: data
    });
    
  } catch (error) {
    console.error('Error updating class instance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// SESSION MANAGEMENT
// =====================================================

// Get sessions for a class instance
router.get('/api/class-instances/:instanceId/sessions', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { status, include_attendance } = req.query;
    
    let query = supabase
      .from('class_sessions')
      .select('*')
      .eq('class_instance_id', instanceId);
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data: sessions, error } = await query.order('date', { ascending: true });
    
    if (error) throw error;
    
    // Get enrolled students count for this class
    const { data: enrollments, error: enrollmentError } = await supabase
      .from('enrollments')
      .select('id')
      .eq('class_instance_id', instanceId)
      .eq('status', 'active');
    
    if (enrollmentError) {
      console.error('Error fetching enrollments:', enrollmentError);
    }
    
    const totalEnrolled = enrollments?.length || 0;
    
    // Always calculate attendance counts for each session
    const sessionsWithAttendance = await Promise.all(
      sessions.map(async (session) => {
        // Get attendance records for this session
        const { data: attendanceRecords, error: attendanceError } = await supabase
          .from('attendance_records')
          .select('status')
          .eq('session_id', session.id);
        
        if (attendanceError) {
          console.error('Error fetching attendance records for session', session.id, attendanceError);
        }
        
        // Count attended students (present + late + excused)
        const attendedCount = attendanceRecords ? 
          attendanceRecords.filter(a => ['present', 'late', 'excused'].includes(a.status)).length : 0;
        
        // Include detailed attendance data if requested
        let attendance = null;
        if (include_attendance === 'true') {
          const { data: detailedAttendance } = await supabase
            .from('attendance_records')
            .select(`
              *,
              students!inner(
                student_id,
                users!inner(first_name, last_name, email)
              )
            `)
            .eq('session_id', session.id);
          
          attendance = detailedAttendance || [];
        }
        
        return {
          ...session,
          attendance_count: attendedCount,
          total_enrolled: totalEnrolled,
          ...(attendance && { attendance })
        };
      })
    );
    
    res.json({
      success: true,
      data: sessionsWithAttendance,
      count: sessionsWithAttendance.length
    });
    
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update session (cancel, reschedule, etc.)
router.put('/api/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { status, notes, date, start_time, end_time } = req.body;
    
    const updateData = {};
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (date) updateData.date = date;
    if (start_time) updateData.start_time = start_time;
    if (end_time) updateData.end_time = end_time;
    
    const { data, error } = await supabase
      .from('class_sessions')
      .update(updateData)
      .eq('id', sessionId)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({
      success: true,
      session: data
    });
    
  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Generate QR code for session
router.get('/api/sessions/:sessionId/qr', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Verify session exists and is not cancelled
    const { data: session, error: sessionError } = await supabase
      .from('class_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('status', 'scheduled')
      .single();
    
    if (sessionError || !session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found or cancelled'
      });
    }
    
    // Generate QR code
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString('hex');
    const qrCodeSecret = crypto.randomBytes(32).toString('hex');
    
    const data = `${sessionId}-${timestamp}-${nonce}-${qrCodeSecret}`;
    const signature = crypto
      .createHmac('sha256', process.env.QR_SECRET || 'fsas_qr_secret_key_2024_secure')
      .update(data)
      .digest('hex');

    const qrData = {
      sessionId,
      timestamp,
      nonce,
      signature
    };

    const qrCodeImage = await QRCode.toDataURL(JSON.stringify(qrData), {
      errorCorrectionLevel: 'M',
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      width: 256
    });

    const expiresAt = new Date(timestamp + (30 * 1000)); // 30 seconds

    // Update session with QR data
    await supabase
      .from('class_sessions')
      .update({
        qr_secret: qrCodeSecret,
        qr_expires_at: expiresAt.toISOString(),
        is_active: true,
        status: 'active'
      })
      .eq('id', sessionId);
    
    res.json({
      success: true,
      data: {
        qr_code: qrCodeImage,
        expires_at: expiresAt.toISOString(),
        session_id: sessionId
      }
    });
    
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate QR code'
    });
  }
});

// =====================================================
// ENROLLMENT MANAGEMENT
// =====================================================

// Enroll students in a class instance
router.post('/api/class-instances/:instanceId/enroll', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { student_ids, enrolled_by, enrollment_method = 'manual' } = req.body;
    
    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Student IDs array is required'
      });
    }
    
    // Check if enrollment deadline has passed
    const { data: classInstance, error: classError } = await supabase
      .from('class_instances')
      .select('enrollment_deadline, max_students, current_enrollment')
      .eq('id', instanceId)
      .single();
    
    if (classError || !classInstance) {
      return res.status(404).json({
        success: false,
        error: 'Class instance not found'
      });
    }
    
    if (new Date() > new Date(classInstance.enrollment_deadline)) {
      return res.status(400).json({
        success: false,
        error: 'Enrollment deadline has passed'
      });
    }
    
    if (classInstance.current_enrollment + student_ids.length > classInstance.max_students) {
      return res.status(400).json({
        success: false,
        error: 'Not enough capacity for all students'
      });
    }
    
    // Create enrollment records
    const enrollmentData = student_ids.map(student_id => ({
      student_id,
      class_instance_id: instanceId,
      enrolled_by,
      enrollment_method,
      status: 'active'
    }));
    
    const { data, error } = await supabase
      .from('enrollments')
      .insert(enrollmentData)
      .select(`
        *,
        students!inner(
          student_id,
          users!inner(first_name, last_name, email)
        )
      `);
    
    if (error) throw error;
    
    res.json({
      success: true,
      enrollments: data,
      count: data.length
    });
    
  } catch (error) {
    console.error('Error enrolling students:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Self-enrollment with class code
router.post('/api/enroll/self', async (req, res) => {
  try {
    const { class_code, student_id } = req.body;
    
    if (!class_code || !student_id) {
      return res.status(400).json({
        success: false,
        error: 'Class code and student ID are required'
      });
    }
    
    // Find class instance by class code
    const { data: classInstance, error: classError } = await supabase
      .from('class_instances')
      .select('id, enrollment_deadline, max_students, current_enrollment, professor_id')
      .eq('class_code', class_code)
      .eq('is_active', true)
      .single();
    
    if (classError || !classInstance) {
      return res.status(404).json({
        success: false,
        error: 'Invalid class code'
      });
    }
    
    // Check enrollment deadline
    if (new Date() > new Date(classInstance.enrollment_deadline)) {
      return res.status(400).json({
        success: false,
        error: 'Enrollment deadline has passed'
      });
    }
    
    // Check capacity
    if (classInstance.current_enrollment >= classInstance.max_students) {
      return res.status(400).json({
        success: false,
        error: 'Class is full'
      });
    }
    
    // Check if already enrolled
    const { data: existingEnrollment } = await supabase
      .from('enrollments')
      .select('id')
      .eq('student_id', student_id)
      .eq('class_instance_id', classInstance.id)
      .single();
    
    if (existingEnrollment) {
      return res.status(400).json({
        success: false,
        error: 'Already enrolled in this class'
      });
    }
    
    // Create enrollment
    const { data, error } = await supabase
      .from('enrollments')
      .insert({
        student_id,
        class_instance_id: classInstance.id,
        enrolled_by: classInstance.professor_id,
        enrollment_method: 'self_enrollment',
        status: 'active'
      })
      .select(`
        *,
        class_instances!inner(
          class_code,
          courses!inner(code, name)
        )
      `)
      .single();
    
    if (error) throw error;
    
    res.json({
      success: true,
      enrollment: data
    });
    
  } catch (error) {
    console.error('Error in self-enrollment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Unenroll student from class instance
router.post('/api/class-instances/:instanceId/unenroll', async (req, res) => {
  try {
    console.log('🔔 INSTANCE UNENROLLMENT ENDPOINT CALLED:', req.params.instanceId);
    const { instanceId } = req.params;
    const { student_id } = req.body;
    
    console.log('📝 Instance unenrollment request:', { instanceId, student_id });
    
    const { data, error } = await supabase
      .from('enrollments')
      .update({ status: 'dropped' })
      .eq('class_instance_id', instanceId)
      .eq('student_id', student_id)
      .select()
      .single();
    
    if (error) throw error;
    
    // Create notification for the unenrolled student
    try {
      console.log('🔔 Creating unenrollment notification for student:', student_id);
      
      // Get class and professor information for the notification
      const { data: classInfo, error: classError } = await supabase
        .from('class_instances')
        .select(`
          id,
          class_code,
          courses!inner(
            code,
            name
          ),
          professors!inner(
            users!inner(
              first_name,
              last_name
            )
          )
        `)
        .eq('id', instanceId)
        .single();
      
      if (!classError && classInfo) {
        const className = `${classInfo.courses.code} - ${classInfo.courses.name}`;
        const professorName = `${classInfo.professors.users.first_name} ${classInfo.professors.users.last_name}`;
        
        const notificationData = {
          user_id: student_id,
          type: 'system',
          title: 'You\'ve been removed from a class',
          message: `You have been removed from ${className} by Professor ${professorName}. Please contact your professor if you have any questions.`,
          priority: 'medium',
          link: `/student/classes`,
          metadata: {
            className,
            professorName,
            unenrollmentDate: new Date().toISOString(),
            notificationType: 'class_unenrolled',
            classInstanceId: instanceId
          }
        };
        
        const { error: notificationError } = await supabase
          .from('notifications')
          .insert(notificationData);
        
        if (notificationError) {
          console.error('❌ Error creating unenrollment notification:', notificationError);
        } else {
          console.log('✅ Unenrollment notification created successfully');
        }
      }
    } catch (notificationErr) {
      console.error('❌ Error in unenrollment notification creation:', notificationErr);
    }
    
    res.json({
      success: true,
      enrollment: data
    });
    
  } catch (error) {
    console.error('Error unenrolling student:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// ATTENDANCE MANAGEMENT
// =====================================================

// Record attendance
router.post('/api/sessions/:sessionId/attendance', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { student_id, device_fingerprint, ip_address, qr_secret_used } = req.body;
    
    // Verify session is active and not cancelled
    const { data: session, error: sessionError } = await supabase
      .from('class_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('is_active', true)
      .neq('status', 'cancelled')
      .single();
    
    if (sessionError || !session) {
      return res.status(400).json({
        success: false,
        error: 'Session is not active or cancelled'
      });
    }
    
    // Verify student is enrolled in the class
    const { data: enrollment, error: enrollmentError } = await supabase
      .from('enrollments')
      .select('id')
      .eq('student_id', student_id)
      .eq('class_instance_id', session.class_instance_id)
      .eq('status', 'active')
      .single();
    
    if (enrollmentError || !enrollment) {
      return res.status(400).json({
        success: false,
        error: 'Student not enrolled in this class'
      });
    }
    
    // Calculate status and minutes late based on class start time
    // Note: This is based on the scheduled class start time, NOT when the professor started the session
    const sessionStart = new Date(`${session.date}T${session.start_time}`);
    const now = new Date();
    const minutesLate = Math.max(0, Math.floor((now - sessionStart) / (1000 * 60)));
    
    let status = 'present';
    if (minutesLate > 5) {
      status = 'late';
    }
    
    const { data, error } = await supabase
      .from('attendance_records')
      .insert({
        session_id: sessionId,
        student_id,
        status,
        minutes_late: minutesLate,
        device_fingerprint,
        ip_address,
        qr_secret_used
      })
      .select(`
        *,
        students!inner(
          student_id,
          users!inner(first_name, last_name, email)
        )
      `)
      .single();
    
    if (error) throw error;
    
    res.json({
      success: true,
      attendance_record: data
    });
    
  } catch (error) {
    console.error('Error recording attendance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update attendance status (professor can change absent to excused)
router.put('/api/attendance/:recordId', async (req, res) => {
  try {
    const { recordId } = req.params;
    const { status, changed_by, reason } = req.body;
    
    const updateData = {
      status,
      status_changed_by: changed_by,
      status_changed_at: new Date().toISOString(),
      status_change_reason: reason
    };
    
    const { data, error } = await supabase
      .from('attendance_records')
      .update(updateData)
      .eq('id', recordId)
      .select(`
        *,
        students!inner(
          student_id,
          users!inner(first_name, last_name, email)
        )
      `)
      .single();
    
    if (error) throw error;
    
    res.json({
      success: true,
      attendance_record: data
    });
    
  } catch (error) {
    console.error('Error updating attendance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get attendance for a session
router.get('/api/sessions/:sessionId/attendance', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const { data, error } = await supabase
      .from('attendance_records')
      .select(`
        *,
        students!inner(
          student_id,
          users!inner(first_name, last_name, email)
        )
      `)
      .eq('session_id', sessionId)
      .order('scanned_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      count: data.length
    });
    
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// ANALYTICS AND REPORTING
// =====================================================

// Get class attendance summary
router.get('/api/class-instances/:instanceId/analytics', async (req, res) => {
  try {
    const { instanceId } = req.params;
    
    // Get summary from materialized view
    const { data: summary, error: summaryError } = await supabase
      .from('class_attendance_summary')
      .select('*')
      .eq('class_instance_id', instanceId)
      .single();
    
    if (summaryError) throw summaryError;
    
    // Get individual student analytics
    const { data: studentAnalytics, error: studentError } = await supabase
      .from('attendance_records')
      .select(`
        student_id,
        status,
        students!inner(
          student_id,
          users!inner(first_name, last_name, email)
        )
      `)
      .in('session_id', 
        supabase
          .from('class_sessions')
          .select('id')
          .eq('class_instance_id', instanceId)
          .neq('status', 'cancelled')
      );
    
    if (studentError) throw studentError;
    
    // Process student analytics
    const studentStats = {};
    studentAnalytics.forEach(record => {
      const studentId = record.student_id;
      if (!studentStats[studentId]) {
        studentStats[studentId] = {
          student: record.students,
          total_sessions: 0,
          present: 0,
          late: 0,
          absent: 0,
          excused: 0
        };
      }
      studentStats[studentId].total_sessions++;
      studentStats[studentId][record.status]++;
    });
    
    // Calculate percentages
    Object.values(studentStats).forEach(stats => {
      if (stats.total_sessions > 0) {
        stats.attendance_rate = Math.round(((stats.present + stats.late) / stats.total_sessions) * 100);
      } else {
        stats.attendance_rate = 0;
      }
    });
    
    res.json({
      success: true,
      summary,
      student_analytics: Object.values(studentStats)
    });
    
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get student attendance history
router.get('/api/students/:studentId/attendance-history', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { class_instance_id, period_id } = req.query;
    
    let query = supabase
      .from('attendance_records')
      .select(`
        *,
        class_sessions!inner(
          session_number,
          date,
          start_time,
          end_time,
          status,
          class_instances!inner(
            class_code,
            courses(code, name),
            academic_periods(name, year, semester)
          )
        )
      `)
      .eq('student_id', studentId);
    
    if (class_instance_id) {
      query = query.eq('class_sessions.class_instance_id', class_instance_id);
    }
    
    if (period_id) {
      query = query.eq('class_sessions.class_instances.academic_period_id', period_id);
    }
    
    const { data, error } = await query.order('class_sessions.date', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      count: data.length
    });
    
  } catch (error) {
    console.error('Error fetching student attendance history:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// UTILITY ENDPOINTS
// =====================================================

// Refresh materialized view
router.post('/api/refresh-analytics', async (req, res) => {
  try {
    const { data, error } = await supabase
      .rpc('refresh_materialized_view', { view_name: 'class_attendance_summary' });
    
    if (error) throw error;
    
    res.json({
      success: true,
      message: 'Analytics refreshed successfully'
    });
    
  } catch (error) {
    console.error('Error refreshing analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get available courses
router.get('/api/courses', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .eq('is_active', true)
      .order('code');
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      count: data.length
    });
    
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get academic periods
router.get('/api/academic-periods', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('academic_periods')
      .select('*')
      .order('year', { ascending: false })
      .order('semester');
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      count: data.length
    });
    
  } catch (error) {
    console.error('Error fetching academic periods:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Toggle pin status for a class instance
router.patch('/api/class-instances/:classInstanceId/pin', async (req, res) => {
  try {
    const { classInstanceId } = req.params;
    const { professor_id } = req.body;
    
    if (!professor_id) {
      return res.status(400).json({
        success: false,
        error: 'Professor ID is required'
      });
    }
    
    // Use the toggle_class_pin function
    const { data, error } = await supabase
      .rpc('toggle_class_pin', {
        p_class_instance_id: classInstanceId,
        p_professor_id: professor_id
      });
    
    if (error) throw error;
    
    if (data === null) {
      return res.status(404).json({
        success: false,
        error: 'Class not found or access denied'
      });
    }
    
    console.log('📌 Pin status toggled for class:', classInstanceId, 'New status:', data);
    
    res.json({
      success: true,
      is_pinned: data,
      message: data ? 'Class pinned successfully' : 'Class unpinned successfully'
    });
    
  } catch (error) {
    console.error('❌ Pin toggle error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get students enrolled in a class instance
router.get('/api/class-instances/:classInstanceId/students', async (req, res) => {
  try {
    const { classInstanceId } = req.params;
    
    const { data, error } = await supabase
      .from('enrollments')
      .select(`
        *,
        students(
          user_id,
          student_id,
          users!inner(
            first_name,
            last_name,
            email
          )
        )
      `)
      .eq('class_instance_id', classInstanceId)
      .eq('status', 'active');
    
    if (error) throw error;
    
    // Transform the data to match expected format
    const students = data.map(enrollment => ({
      id: enrollment.id,
      user_id: enrollment.student_id,
      first_name: enrollment.students?.users?.first_name || '',
      last_name: enrollment.students?.users?.last_name || '',
      email: enrollment.students?.users?.email || '',
      student_id: enrollment.students?.student_id || '',
      enrollment_date: enrollment.created_at,
      status: enrollment.status
    }));
    
    res.json({
      success: true,
      data: students,
      count: students.length
    });
    
  } catch (error) {
    console.error('❌ Error fetching class students:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enroll a student in a class instance
router.post('/api/class-instances/:classInstanceId/enroll', async (req, res) => {
  try {
    const { classInstanceId } = req.params;
    const { student_email, professor_id } = req.body;
    
    if (!student_email || !professor_id) {
      return res.status(400).json({
        success: false,
        error: 'Student email and professor ID are required'
      });
    }
    
    // First, find the student by email
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select(`
        user_id,
        student_id,
        users!inner(
          first_name,
          last_name,
          email
        )
      `)
      .eq('users.email', student_email)
      .single();
    
    if (studentError || !student) {
      return res.status(404).json({
        success: false,
        error: 'Student not found with that email'
      });
    }
    
    // Check if student is already enrolled
    const { data: existingEnrollment } = await supabase
      .from('enrollments')
      .select('id')
      .eq('class_instance_id', classInstanceId)
      .eq('student_id', student.user_id)
      .eq('status', 'active')
      .single();
    
    if (existingEnrollment) {
      return res.status(400).json({
        success: false,
        error: `${student.users.first_name} ${student.users.last_name} is already enrolled in this course`
      });
    }
    
    // Get class and professor information for notification
    const { data: classInfo, error: classError } = await supabase
      .from('class_instances')
      .select(`
        id,
        class_code,
        courses!inner(
          code,
          name
        ),
        professors!inner(
          user_id,
          users!inner(
            first_name,
            last_name
          )
        )
      `)
      .eq('id', classInstanceId)
      .single();
    
    if (classError) {
      console.error('❌ Error fetching class info:', classError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch class information'
      });
    }
    
    // Enroll the student
    const { data: enrollment, error: enrollError } = await supabase
      .from('enrollments')
      .insert({
        class_instance_id: classInstanceId,
        student_id: student.user_id,
        status: 'active'
      })
      .select()
      .single();
    
    if (enrollError) throw enrollError;
    
    // Create notification for the student
    try {
      const className = `${classInfo.courses.code} - ${classInfo.courses.name}`;
      const professorName = `${classInfo.professors.users.first_name} ${classInfo.professors.users.last_name}`;
      
      const { error: notificationError } = await supabase
        .from('notifications')
        .insert({
          user_id: student.user_id,
          type: 'system', // Use 'system' type since 'class_enrolled' isn't available yet
          title: 'You\'ve been enrolled in a new class!',
          message: `You have been enrolled in ${className} by Professor ${professorName}. Check your dashboard to view class details.`,
          priority: 'high',
          link: `/student/classes/${classInstanceId}`,
          // Remove class_id to avoid foreign key constraint issues
          metadata: {
            className,
            professorName,
            enrollmentDate: new Date().toISOString(),
            notificationType: 'class_enrolled', // Store the intended type in metadata
            classInstanceId: classInstanceId
          }
        });
      
      if (notificationError) {
        console.error('❌ Error creating enrollment notification:', notificationError);
      } else {
        console.log('✅ Enrollment notification created for student:', student.users?.email);
      }
    } catch (notificationErr) {
      console.error('❌ Error in notification creation:', notificationErr);
    }
    
    console.log('✅ Student enrolled successfully:', student.users?.email);
    
    res.json({
      success: true,
      message: 'Student enrolled successfully',
      student: {
        id: enrollment.id,
        user_id: student.user_id,
        first_name: student.users?.first_name || '',
        last_name: student.users?.last_name || '',
        email: student.users?.email || '',
        student_id: student.student_id,
        enrollment_date: enrollment.created_at,
        status: enrollment.status
      }
    });
    
  } catch (error) {
    console.error('❌ Error enrolling student:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all students for enrollment
router.get('/api/students/all', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    
    const { data, error } = await supabase
      .from('students')
      .select(`
        user_id,
        student_id,
        users!inner(
          first_name,
          last_name,
          email,
          role
        )
      `)
      .eq('users.role', 'student')
      .order('first_name', { ascending: true, foreignTable: 'users' })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) throw error;

    // Transform the data to match expected format
    const students = data.map(student => ({
      user_id: student.user_id,
      first_name: student.users?.first_name || '',
      last_name: student.users?.last_name || '',
      email: student.users?.email || '',
      student_id: student.student_id || ''
    }));

    res.json({
      success: true,
      data: students,
      count: students.length
    });

  } catch (error) {
    console.error('❌ Error fetching all students:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch students'
    });
  }
});

// Search students for enrollment
router.get('/api/students/search', async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({
        success: true,
        data: [],
        count: 0
      });
    }

    const searchTerm = `%${q.trim()}%`;
    
    // Search students by student_id first
    const { data: studentsByID, error: studentsError } = await supabase
      .from('students')
      .select('user_id, student_id')
      .ilike('student_id', searchTerm)
      .limit(parseInt(limit));

    if (studentsError) throw studentsError;

    // Search users by name and email
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email')
      .or(`first_name.ilike."${searchTerm}",last_name.ilike."${searchTerm}",email.ilike."${searchTerm}"`)
      .limit(parseInt(limit));

    if (usersError) throw usersError;

    // Get students for the found users
    const userIds = users.map(u => u.id);
    const { data: studentsByUser, error: studentsByUserError } = await supabase
      .from('students')
      .select('user_id, student_id')
      .in('user_id', userIds);

    if (studentsByUserError) throw studentsByUserError;

    // Get user details for students found by ID
    const studentUserIds = studentsByID.map(s => s.user_id);
    const { data: usersForStudents, error: usersForStudentsError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email')
      .in('id', studentUserIds);

    if (usersForStudentsError) throw usersForStudentsError;

    // Combine all results
    const allStudents = [...studentsByID, ...studentsByUser];
    const allUsers = [...users, ...usersForStudents];

    // Remove duplicates and combine data
    const uniqueStudents = allStudents.filter((student, index, self) => 
      index === self.findIndex(s => s.user_id === student.user_id)
    );

    const uniqueUsers = allUsers.filter((user, index, self) => 
      index === self.findIndex(u => u.id === user.id)
    );

    const combinedData = uniqueStudents.map(student => {
      const user = uniqueUsers.find(u => u.id === student.user_id);
      return {
        user_id: student.user_id,
        first_name: user?.first_name || '',
        last_name: user?.last_name || '',
        email: user?.email || '',
        student_id: student.student_id || ''
      };
    });

    res.json({
      success: true,
      data: combinedData,
      count: combinedData.length
    });

  } catch (error) {
    console.error('❌ Error searching students:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search students'
    });
  }
});

// Bulk enroll students in a class instance
router.post('/api/class-instances/:classInstanceId/bulk-enroll', async (req, res) => {
  try {
    const { classInstanceId } = req.params;
    const { student_ids, professor_id } = req.body;

    if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Student IDs array is required'
      });
    }

    if (!professor_id) {
      return res.status(400).json({
        success: false,
        error: 'Professor ID is required'
      });
    }

    // Verify the professor owns this class
    const { data: classInstance, error: classError } = await supabase
      .from('class_instances')
      .select(`
        id, 
        professor_id, 
        max_students, 
        current_enrollment, 
        academic_period_id,
        course_id,
        courses!inner(
          id,
          code,
          name
        ),
        professors!inner(
          users!inner(
            first_name,
            last_name
          )
        )
      `)
      .eq('id', classInstanceId)
      .eq('professor_id', professor_id)
      .single();

    if (classError || !classInstance) {
      return res.status(404).json({
        success: false,
        error: 'Class not found or access denied'
      });
    }

    // Find the corresponding class_id from the classes table
    const { data: classRecords, error: classRecordError } = await supabase
      .from('classes')
      .select('id')
      .eq('professor_id', professor_id)
      .eq('academic_period_id', classInstance.academic_period_id)
      .eq('code', classInstance.courses.code);

    if (classRecordError || !classRecords || classRecords.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Corresponding class record not found'
      });
    }

    // Use the first matching class record (there might be multiple sections)
    const classRecord = classRecords[0];

    // Check if adding these students would exceed capacity
    const totalEnrollment = classInstance.current_enrollment + student_ids.length;
    if (totalEnrollment > classInstance.max_students) {
      return res.status(400).json({
        success: false,
        error: `Adding ${student_ids.length} students would exceed class capacity (${classInstance.max_students} students max)`
      });
    }

    // Check which students are already enrolled (any status)
    const { data: existingEnrollments, error: existingError } = await supabase
      .from('enrollments')
      .select('student_id, status')
      .eq('class_id', classRecord.id)
      .eq('academic_period_id', classInstance.academic_period_id)
      .in('student_id', student_ids);

    if (existingError) throw existingError;

    const alreadyEnrolled = existingEnrollments.map(e => e.student_id);
    const droppedEnrollments = existingEnrollments.filter(e => e.status === 'dropped');
    const activeEnrollments = existingEnrollments.filter(e => e.status === 'active');
    
    // Students who are already actively enrolled
    const activeStudentIds = activeEnrollments.map(e => e.student_id);
    // Students who were dropped and can be re-enrolled
    const droppedStudentIds = droppedEnrollments.map(e => e.student_id);
    // Students who are completely new
    const newStudentIds = student_ids.filter(id => !alreadyEnrolled.includes(id));

    if (newStudentIds.length === 0 && droppedStudentIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'All selected students are already enrolled in this course',
        enrolled: [],
        already_enrolled: activeStudentIds
      });
    }

    let enrollments = [];
    let reEnrolledStudents = [];

    // Re-enroll dropped students by updating their status
    if (droppedStudentIds.length > 0) {
      const { data: reEnrollments, error: reEnrollError } = await supabase
        .from('enrollments')
        .update({ 
          status: 'active'
        })
        .eq('class_id', classRecord.id)
        .eq('academic_period_id', classInstance.academic_period_id)
        .in('student_id', droppedStudentIds)
        .select();

      if (reEnrollError) throw reEnrollError;
      reEnrolledStudents = reEnrollments || [];
    }

    // Create enrollment records for completely new students
    if (newStudentIds.length > 0) {
      const enrollmentRecords = newStudentIds.map(student_id => ({
        class_id: classRecord.id, // Use the correct class_id from classes table
        class_instance_id: classInstanceId,
        student_id: student_id,
        academic_period_id: classInstance.academic_period_id,
        enrolled_by: professor_id,
        enrollment_date: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
        status: 'active',
        created_at: new Date().toISOString()
      }));

      const { data: newEnrollments, error: enrollError } = await supabase
        .from('enrollments')
        .insert(enrollmentRecords)
        .select();

      if (enrollError) throw enrollError;
      enrollments = newEnrollments || [];
    }

    // Combine all enrollments
    const allEnrollments = [...enrollments, ...reEnrolledStudents];
    const totalNewEnrollments = newStudentIds.length + droppedStudentIds.length;

    // Update the current enrollment count
    const { error: updateError } = await supabase
      .from('class_instances')
      .update({ 
        current_enrollment: classInstance.current_enrollment + totalNewEnrollments,
        updated_at: new Date().toISOString()
      })
      .eq('id', classInstanceId);

    if (updateError) throw updateError;

    // Create notifications for newly enrolled students
    try {
      const className = `${classInstance.courses.code} - ${classInstance.courses.name}`;
      const professorName = `${classInstance.professors.users.first_name} ${classInstance.professors.users.last_name}`;
      
      // Get professor info for notifications
      const { data: professorInfo, error: profError } = await supabase
        .from('professors')
        .select(`
          user_id,
          users!inner(
            first_name,
            last_name
          )
        `)
        .eq('user_id', professor_id)
        .single();
      
      if (!profError && professorInfo) {
        const notificationsToCreate = [...newStudentIds, ...droppedStudentIds].map(studentId => ({
          user_id: studentId,
          type: 'system', // Use 'system' type since 'class_enrolled' isn't available yet
          title: 'You\'ve been enrolled in a new class!',
          message: `You have been enrolled in ${className} by Professor ${professorInfo.users.first_name} ${professorInfo.users.last_name}. Check your dashboard to view class details.`,
          priority: 'high',
          link: `/student/classes/${classInstanceId}`,
          // Remove class_id to avoid foreign key constraint issues
          metadata: {
            className,
            professorName: `${professorInfo.users.first_name} ${professorInfo.users.last_name}`,
            enrollmentDate: new Date().toISOString(),
            notificationType: 'class_enrolled', // Store the intended type in metadata
            classInstanceId: classInstanceId
          }
        }));

        if (notificationsToCreate.length > 0) {
          const { error: notificationError } = await supabase
            .from('notifications')
            .insert(notificationsToCreate);
          
          if (notificationError) {
            console.error('❌ Error creating bulk enrollment notifications:', notificationError);
          } else {
            console.log(`✅ Bulk enrollment notifications created for ${notificationsToCreate.length} students`);
          }
        }
      }
    } catch (notificationErr) {
      console.error('❌ Error in bulk notification creation:', notificationErr);
    }

    let message = `Successfully enrolled ${totalNewEnrollments} student${totalNewEnrollments !== 1 ? 's' : ''}`;
    if (newStudentIds.length > 0 && droppedStudentIds.length > 0) {
      message += ` (${newStudentIds.length} new, ${droppedStudentIds.length} re-enrolled)`;
    } else if (droppedStudentIds.length > 0) {
      message += ` (${droppedStudentIds.length} re-enrolled)`;
    }
    if (activeStudentIds.length > 0) {
      message += ` (${activeStudentIds.length} student${activeStudentIds.length !== 1 ? 's' : ''} were already enrolled)`;
    }

    res.json({
      success: true,
      message: message,
      enrolled: [...newStudentIds, ...droppedStudentIds],
      already_enrolled: activeStudentIds,
      re_enrolled: droppedStudentIds,
      total_enrolled: allEnrollments.length
    });

  } catch (error) {
    console.error('❌ Error bulk enrolling students:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });
    res.status(500).json({
      success: false,
      error: 'Failed to enroll students',
      details: error.message
    });
  }
});

// Unenroll a student from a class instance
router.post('/api/class-instances/:classInstanceId/unenroll', async (req, res) => {
  try {
    console.log('🔔 UNENROLLMENT ENDPOINT CALLED:', req.params.classInstanceId);
    const { classInstanceId } = req.params;
    const { student_id, professor_id } = req.body;
    
    console.log('📝 Unenrollment request:', { classInstanceId, student_id, professor_id });
    
    if (!student_id || !professor_id) {
      console.log('❌ Missing required fields');
      return res.status(400).json({
        success: false,
        error: 'Student ID and professor ID are required'
      });
    }
    
    // Update enrollment status to inactive
    const { error } = await supabase
      .from('enrollments')
      .update({ status: 'inactive' })
      .eq('class_instance_id', classInstanceId)
      .eq('student_id', student_id);
    
    if (error) throw error;
    
    // Create notification for the unenrolled student
    try {
      console.log('🔔 Creating unenrollment notification for student:', student_id);
      
      // Get class and professor information for the notification
      const { data: classInfo, error: classError } = await supabase
        .from('class_instances')
        .select(`
          id,
          class_code,
          courses!inner(
            code,
            name
          ),
          professors!inner(
            users!inner(
              first_name,
              last_name
            )
          )
        `)
        .eq('id', classInstanceId)
        .single();
      
      if (!classError && classInfo) {
        const className = `${classInfo.courses.code} - ${classInfo.courses.name}`;
        const professorName = `${classInfo.professors.users.first_name} ${classInfo.professors.users.last_name}`;
        
        const notificationData = {
          user_id: student_id,
          type: 'system', // Use 'system' type since 'class_unenrolled' isn't available yet
          title: 'You\'ve been removed from a class',
          message: `You have been removed from ${className} by Professor ${professorName}. Please contact your professor if you have any questions.`,
          priority: 'medium',
          link: `/student/classes`,
          metadata: {
            className,
            professorName,
            unenrollmentDate: new Date().toISOString(),
            notificationType: 'class_unenrolled', // Store the intended type in metadata
            classInstanceId: classInstanceId
          }
        };
        
        const { error: notificationError } = await supabase
          .from('notifications')
          .insert(notificationData);
        
        if (notificationError) {
          console.error('❌ Error creating unenrollment notification:', notificationError);
        } else {
          console.log('✅ Unenrollment notification created successfully');
        }
      }
    } catch (notificationErr) {
      console.error('❌ Error in unenrollment notification creation:', notificationErr);
    }
    
    console.log('✅ Student unenrolled successfully:', student_id);
    
    res.json({
      success: true,
      message: 'Student unenrolled successfully'
    });
    
  } catch (error) {
    console.error('❌ Error unenrolling student:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete a class instance
router.delete('/api/class-instances/:classInstanceId', async (req, res) => {
  try {
    const { classInstanceId } = req.params;
    const { professor_id } = req.body;

    if (!professor_id) {
      return res.status(400).json({
        success: false,
        error: 'Professor ID is required'
      });
    }

    // Verify the class instance belongs to the professor
    const { data: classInstance, error: classError } = await supabase
      .from('class_instances')
      .select('id, professor_id, class_code, courses(name)')
      .eq('id', classInstanceId)
      .eq('professor_id', professor_id)
      .single();

    if (classError || !classInstance) {
      return res.status(404).json({
        success: false,
        error: 'Class not found or access denied'
      });
    }

    // Delete related data in the correct order (due to foreign key constraints)
    
    // 1. First get all session IDs for this class instance
    const { data: sessions, error: sessionsQueryError } = await supabase
      .from('class_sessions')
      .select('id')
      .eq('class_instance_id', classInstanceId);

    if (sessionsQueryError) {
      console.error('Error fetching sessions for deletion:', sessionsQueryError);
      return res.status(500).json({ error: 'Failed to fetch class sessions for deletion' });
    }

    const sessionIds = sessions.map(session => session.id);

    // 2. Delete attendance records if there are any sessions
    if (sessionIds.length > 0) {
      const { error: attendanceError } = await supabase
        .from('attendance_records')
        .delete()
        .in('session_id', sessionIds);

      if (attendanceError) {
        console.error('Error deleting attendance records:', attendanceError);
        // Continue with deletion even if attendance records fail
      }
    }

    // 3. Delete class sessions
    const { error: sessionsError } = await supabase
      .from('class_sessions')
      .delete()
      .eq('class_instance_id', classInstanceId);

    if (sessionsError) {
      console.error('Error deleting class sessions:', sessionsError);
      // Continue with deletion even if sessions fail
    }

    // 4. Delete enrollments
    const { error: enrollmentsError } = await supabase
      .from('enrollments')
      .delete()
      .eq('class_instance_id', classInstanceId);

    if (enrollmentsError) {
      console.error('Error deleting enrollments:', enrollmentsError);
      // Continue with deletion even if enrollments fail
    }

    // 5. Delete the class instance itself
    const { error: deleteError } = await supabase
      .from('class_instances')
      .delete()
      .eq('id', classInstanceId);

    if (deleteError) {
      throw deleteError;
    }

    res.json({
      success: true,
      message: `Class "${classInstance.courses?.name || classInstance.class_code}" deleted successfully`
    });

  } catch (error) {
    console.error('❌ Error deleting class instance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update class instance status
router.patch('/api/class-instances/:classInstanceId/status', async (req, res) => {
  try {
    const { classInstanceId } = req.params;
    const { professor_id, status } = req.body;

    if (!professor_id || !status) {
      return res.status(400).json({
        success: false,
        error: 'Professor ID and status are required'
      });
    }

    if (!['active', 'inactive', 'completed'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Status must be one of: active, inactive, completed'
      });
    }

    // Verify the class instance belongs to the professor
    const { data: classInstance, error: classError } = await supabase
      .from('class_instances')
      .select('id, professor_id, class_code, courses(name)')
      .eq('id', classInstanceId)
      .eq('professor_id', professor_id)
      .single();

    if (classError || !classInstance) {
      return res.status(404).json({
        success: false,
        error: 'Class not found or access denied'
      });
    }

    // Update the status
    const { error: updateError } = await supabase
      .from('class_instances')
      .update({ 
        status: status,
        is_active: status === 'active',
        updated_at: new Date().toISOString()
      })
      .eq('id', classInstanceId);

    if (updateError) {
      throw updateError;
    }

    res.json({
      success: true,
      message: `Class status updated to ${status} successfully`
    });

  } catch (error) {
    console.error('❌ Error updating class status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
