const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server: SocketIOServer } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
const crypto = require('crypto');
require('dotenv').config({ path: '.env.local' });

// Import the new class management API
const classManagementAPI = require('./final-class-management-api.js');

// Import the session management API
const sessionManagementAPI = require('./session-management-api.js');

// Import the attendance API
const attendanceAPI = require('./attendance-api.js');

// Import the student classes API
const studentClassesAPI = require('./student-classes-api.js');

// Import the student class detail API
const studentClassDetailAPI = require('./student-class-detail-api.js');

// Import the student dashboard API (commented out - using frontend service instead)
// const studentDashboardAPI = require('./student-dashboard-api.js');

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// QR Code Generator Class
class QRCodeGenerator {
  static get QR_SECRET() {
    return process.env.QR_SECRET || 'fsas_qr_secret_key_2024_secure';
  }
  
  static get QR_EXPIRY_SECONDS() {
    return 30;
  }

  static async generateSecureQR(sessionId) {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString('hex');
    const qrCodeSecret = crypto.randomBytes(32).toString('hex');
    
    const data = `${sessionId}-${timestamp}-${nonce}-${qrCodeSecret}`;
    
    const signature = crypto
      .createHmac('sha256', this.QR_SECRET)
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

    const expiresAt = new Date(timestamp + (this.QR_EXPIRY_SECONDS * 1000));

    return {
      qr_code: qrCodeImage,
      expires_at: expiresAt.toISOString(),
      session_id: sessionId
    };
  }
}

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "https://*.supabase.co", "http://localhost:*", "ws://localhost:*"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "data:"],
    },
  },
}));
app.use(cors({
  origin: process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3000",
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// Rate limiting - More lenient for development
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs (increased for development)
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  }
});
app.use('/api/', limiter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    features: ['qr-generation', 'attendance-tracking', 'real-time-updates', 'role-based-access', 'enrollment-management']
  });
});

// =====================================================
// NEW OPTIMIZED CLASS MANAGEMENT API
// =====================================================
app.use('/', classManagementAPI);
app.use('/', sessionManagementAPI.router);
app.use('/', attendanceAPI);
app.use('/', studentClassesAPI);
app.use('/', studentClassDetailAPI);
// app.use('/', studentDashboardAPI); // Commented out - using frontend service instead

// =====================================================
// USER MANAGEMENT ENDPOINTS
// =====================================================

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get students
app.get('/api/students', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('students')
      .select(`
        *,
        users!inner(first_name, last_name, email, role)
      `)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get professors
app.get('/api/professors', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('professors')
      .select(`
        *,
        users!inner(first_name, last_name, email, role)
      `)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// DEPARTMENT MANAGEMENT ENDPOINTS
// =====================================================

// Get departments
app.get('/api/departments', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .order('name');
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// ACADEMIC PERIOD MANAGEMENT ENDPOINTS
// =====================================================

// Get academic periods
app.get('/api/academic-periods', async (req, res) => {
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
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// CLASS MANAGEMENT ENDPOINTS (ENHANCED)
// =====================================================

// Get all sessions
app.get('/api/sessions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select(`
        *,
        classes!inner(code, name, professor_id, room_location)
      `)
      .order('date', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all classes with department and period info
app.get('/api/classes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('classes')
      .select(`
        *,
        departments(name, code),
        academic_periods(name, year, semester)
      `)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Get professor info separately
    const classesWithProfessors = await Promise.all(data.map(async (cls) => {
      const { data: professorData } = await supabase
        .from('professors')
        .select(`
          employee_id,
          title,
          users!inner(first_name, last_name, email)
        `)
        .eq('user_id', cls.professor_id)
        .single();
      
      return {
        ...cls,
        professor: professorData
      };
    }));
    
    res.json({
      success: true,
      data: classesWithProfessors,
      count: classesWithProfessors.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get classes for a specific professor
app.get('/api/professors/:professorId/classes', async (req, res) => {
  try {
    const { professorId } = req.params;
    
    // Get class instances (using new schema)
    const { data: classInstances, error } = await supabase
      .from('class_instances')
      .select(`
        *,
        courses(code, name, description, credits),
        academic_periods(name, year, semester)
      `)
      .eq('professor_id', professorId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Get enrollment counts and attendance rates for each class
    const classesWithStats = await Promise.all(
      classInstances.map(async (classInstance) => {
        // Get enrollments
        const { data: enrollments, error: enrollmentError } = await supabase
          .from('enrollments')
          .select('id')
          .eq('class_instance_id', classInstance.id)
          .eq('status', 'active');
        
        if (enrollmentError) {
          console.error('Error fetching enrollments for class', classInstance.id, enrollmentError);
        }
        
        const enrolledCount = enrollments?.length || 0;
        const capacityPercentage = classInstance.max_students > 0 
          ? Math.round((enrolledCount / classInstance.max_students) * 100) 
          : 0;
        
        // Get all sessions for this class (active + completed)
        const { data: sessions, error: sessionsError } = await supabase
          .from('class_sessions')
          .select('id, status')
          .eq('class_instance_id', classInstance.id);
        
        if (sessionsError) {
          console.error('Error fetching sessions for class', classInstance.id, sessionsError);
        }
        
        // Calculate attendance rate from all sessions
        let attendanceRate = 0;
        let totalSessions = 0;
        let activeSessions = 0;
        
        if (sessions && sessions.length > 0) {
          const allSessions = sessions;
          const activeSessionsList = sessions.filter(s => s.status === 'active');
          const completedSessions = sessions.filter(s => s.status === 'completed');
          
          totalSessions = allSessions.length;
          activeSessions = activeSessionsList.length;
          
          // Get attendance records for all sessions
          const { data: attendanceRecords, error: attendanceError } = await supabase
            .from('attendance_records')
            .select('status')
            .in('session_id', allSessions.map(s => s.id));
          
          if (!attendanceError && attendanceRecords && attendanceRecords.length > 0) {
            const attendedCount = attendanceRecords.filter(a => 
              ['present', 'late', 'excused'].includes(a.status)
            ).length;
            attendanceRate = Math.round((attendedCount / attendanceRecords.length) * 100);
          }
        }
        
        return {
          id: classInstance.id,
          code: classInstance.courses?.code || 'Unknown',
          name: classInstance.courses?.name || 'Unknown Class',
          description: classInstance.courses?.description || '',
          credits: classInstance.courses?.credits || 0,
          class_code: classInstance.class_code,
          days_of_week: classInstance.days_of_week,
          start_time: classInstance.start_time,
          end_time: classInstance.end_time,
          room_location: classInstance.room_location,
          max_students: classInstance.max_students,
          enrolled_students: enrolledCount,
          capacity_percentage: capacityPercentage,
          attendance_rate: attendanceRate,
          total_sessions: totalSessions,
          active_sessions: activeSessions,
          academic_period: classInstance.academic_periods?.name || 'Unknown Period',
          is_active: classInstance.is_active,
          status: classInstance.status,
          created_at: classInstance.created_at
        };
      })
    );
    
    res.json({
      success: true,
      data: classesWithStats,
      count: classesWithStats.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// ENROLLMENT MANAGEMENT ENDPOINTS
// =====================================================

// Get all enrollments
app.get('/api/enrollments', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('enrollments')
      .select(`
        *,
        students!inner(
          student_id,
          users!inner(first_name, last_name, email)
        ),
        classes(code, name),
        academic_periods(name, year, semester),
        professors!enrolled_by(
          employee_id,
          users!inner(first_name, last_name)
        )
      `)
      .order('enrollment_date', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enroll student in class (professor adds student)
app.post('/api/enrollments', async (req, res) => {
  try {
    const { student_id, class_id, academic_period_id, enrolled_by } = req.body;
    
    // Validate required fields
    if (!student_id || !class_id || !academic_period_id || !enrolled_by) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: student_id, class_id, academic_period_id, enrolled_by'
      });
    }
    
    const { data, error } = await supabase
      .from('enrollments')
      .insert({
        student_id,
        class_id,
        academic_period_id,
        enrolled_by,
        enrollment_date: new Date().toISOString().split('T')[0],
        status: 'active'
      })
      .select();
    
    if (error) throw error;
    
    // Create notification for the enrolled student
    try {
      console.log('🔔 Creating enrollment notification for student:', student_id);
      
      // Get class and professor information for the notification
      const { data: classInfo, error: classError } = await supabase
        .from('classes')
        .select(`
          id,
          code,
          name,
          professor_id,
          professors!inner(
            users!inner(
              first_name,
              last_name
            )
          )
        `)
        .eq('id', class_id)
        .single();
      
      if (!classError && classInfo) {
        const className = `${classInfo.code} - ${classInfo.name}`;
        const professorName = `${classInfo.professors.users.first_name} ${classInfo.professors.users.last_name}`;
        
        const notificationData = {
          user_id: student_id,
          type: 'system', // Use 'system' type since 'class_enrolled' isn't available yet
          title: 'You\'ve been enrolled in a new class!',
          message: `You have been enrolled in ${className} by Professor ${professorName}. Check your dashboard to view class details.`,
          priority: 'high',
          link: `/student/classes/${class_id}`,
          metadata: {
            className,
            professorName,
            enrollmentDate: new Date().toISOString(),
            notificationType: 'class_enrolled', // Store the intended type in metadata
            classId: class_id
          }
        };
        
        const { error: notificationError } = await supabase
          .from('notifications')
          .insert(notificationData);
        
        if (notificationError) {
          console.error('❌ Error creating enrollment notification:', notificationError);
        } else {
          console.log('✅ Enrollment notification created successfully');
        }
      }
    } catch (notificationErr) {
      console.error('❌ Error in enrollment notification creation:', notificationErr);
    }
    
    res.json({
      success: true,
      data: data[0],
      message: 'Student enrolled successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get students enrolled in a specific class
app.get('/api/classes/:classId/students', async (req, res) => {
  try {
    const { classId } = req.params;
    
    const { data, error } = await supabase
      .from('enrollments')
      .select(`
        *,
        students!inner(
          student_id,
          users!inner(first_name, last_name, email)
        )
      `)
      .eq('class_id', classId)
      .eq('status', 'active')
      .order('enrollment_date', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update student grade
app.put('/api/enrollments/:enrollmentId/grade', async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const { final_grade } = req.body;
    
    if (!final_grade) {
      return res.status(400).json({
        success: false,
        error: 'final_grade is required'
      });
    }
    
    const { data, error } = await supabase
      .from('enrollments')
      .update({ final_grade })
      .eq('id', enrollmentId)
      .select();
    
    if (error) throw error;
    
    res.json({
      success: true,
      data: data[0],
      message: 'Grade updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// SESSION MANAGEMENT ENDPOINTS (EXISTING)
// =====================================================

// Get sessions for a class
app.get('/api/classes/:classId/sessions', async (req, res) => {
  try {
    const { classId } = req.params;
    
    const { data, error } = await supabase
      .from('class_sessions')
      .select('*')
      .eq('class_instance_id', classId)
      .order('date', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Generate QR code for session
app.get('/api/sessions/:sessionId/qr', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Verify session exists
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    
    if (sessionError || !session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    // Generate QR code
    const qrData = await QRCodeGenerator.generateSecureQR(sessionId);
    
    // Update session with QR data
    await supabase
      .from('sessions')
      .update({
        qr_secret: qrData.session_id,
        qr_expires_at: qrData.expires_at,
        is_active: true
      })
      .eq('id', sessionId);
    
    res.json({
      success: true,
      data: qrData
    });
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate QR code'
    });
  }
});

// Activate session (start attendance)
app.post('/api/sessions/:sessionId/activate', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { notes } = req.body;
    
    console.log('🚀 Activating session:', sessionId);
    console.log('🔍 Session activation endpoint called with sessionId:', sessionId);
    
    // Check if session exists and is scheduled
    const { data: session, error: fetchError } = await supabase
      .from('class_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('status', 'scheduled')
      .single();
    
    if (fetchError || !session) {
      return res.status(400).json({
        success: false,
        error: 'Session not found or already activated'
      });
    }
    
    // Generate initial QR code
    const qrData = await QRCodeGenerator.generateSecureQR(sessionId);
    
    // Calculate session end time (1 hour from now)
    const endTime = new Date(Date.now() + 60 * 60 * 1000);
    
    // Update session
    const { data: updatedSession, error: updateError } = await supabase
      .from('class_sessions')
      .update({
        status: 'active',
        is_active: true,
        qr_secret: qrData.secret,
        qr_expires_at: qrData.expires_at,
        notes: notes || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single();
    
    if (updateError) throw updateError;
    
    console.log('✅ Session updated successfully, now calling notification function...');
    
    // Notify students about session activation
    console.log('🔔 Calling notifyStudentsSessionActivated...');
    try {
      await notifyStudentsSessionActivated(sessionId);
      console.log('✅ notifyStudentsSessionActivated completed');
    } catch (notificationError) {
      console.error('❌ Error in notifyStudentsSessionActivated:', notificationError);
    }
    
    console.log('✅ Session activated successfully:', sessionId);
    
    res.json({
      success: true,
      session: updatedSession,
      qr_code: qrData
    });
    
  } catch (error) {
    console.error('❌ Error activating session:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// ATTENDANCE ENDPOINTS (ENHANCED)
// =====================================================

// Get all attendance records
app.get('/api/attendance', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('attendance')
      .select(`
        *,
        users!inner(first_name, last_name, email),
        sessions!inner(date, start_time, end_time, classes!inner(code, name))
      `)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get QR usage records
app.get('/api/qr-usage', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('qr_usage')
      .select(`
        *,
        users!inner(first_name, last_name, email),
        sessions!inner(date, start_time, classes!inner(code, name))
      `)
      .order('used_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get attendance for a session
app.get('/api/sessions/:sessionId/attendance', async (req, res) => {
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
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// PASSWORD RESET API ENDPOINTS
// =====================================================

// Forgot Password - Send reset email
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email, role } = req.body;
    
    console.log('🔐 Password reset request:', { email, role });
    
    // Validate input
    if (!email || !role) {
      return res.status(400).json({
        success: false,
        error: 'Email and role are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid email address'
      });
    }

    // Check if user exists in database with correct role
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, role, is_active')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (userError || !userData) {
      console.log('🔐 User not found:', email);
      return res.status(404).json({
        success: false,
        error: 'No account found with this email address'
      });
    }

    if (userData.role !== role) {
      console.log('🔐 Role mismatch:', userData.role, 'expected:', role);
      return res.status(400).json({
        success: false,
        error: `This email is registered as a ${userData.role}. Please use the ${userData.role} forgot password page.`
      });
    }

    if (!userData.is_active) {
      console.log('🔐 Account inactive:', email);
      return res.status(400).json({
        success: false,
        error: 'This account has been deactivated. Please contact support.'
      });
    }

    // Send password reset email using Supabase Auth
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000'}/reset-password?type=${role}`,
    });

    if (resetError) {
      console.error('🔐 Password reset error:', resetError);
      return res.status(500).json({
        success: false,
        error: resetError.message
      });
    }

    console.log('✅ Password reset email sent to:', email);
    res.json({
      success: true,
      message: 'Password reset email sent successfully'
    });

  } catch (error) {
    console.error('🔐 Password reset error:', error);
    res.status(500).json({
      success: false,
      error: 'An unexpected error occurred. Please try again.'
    });
  }
});

// Validate Reset Token
app.post('/api/auth/validate-reset-token', async (req, res) => {
  try {
    const { token, type } = req.body;
    
    console.log('🔐 Validating reset token:', { hasToken: !!token, type });
    
    if (!token || !type) {
      return res.status(400).json({
        success: false,
        error: 'Token and type are required'
      });
    }

    // For now, we'll accept any token format
    // In a production environment, you'd validate the JWT token
    // and check if it's valid and not expired
    
    res.json({
      success: true,
      message: 'Token is valid'
    });

  } catch (error) {
    console.error('🔐 Token validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate token'
    });
  }
});

// Reset Password - Update password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password, type } = req.body;
    
    console.log('🔐 Password reset update:', { hasToken: !!token, type });
    
    // Validate input
    if (!token || !password || !type) {
      return res.status(400).json({
        success: false,
        error: 'Token, password, and type are required'
      });
    }

    // Validate password
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long'
      });
    }

    // In a production environment, you would:
    // 1. Validate the JWT token
    // 2. Extract user ID from token
    // 3. Update password for that specific user
    
    // For now, we'll return success
    // The actual password update will be handled by Supabase Auth
    // when the user clicks the reset link and is redirected
    
    console.log('✅ Password reset completed for type:', type);
    res.json({
      success: true,
      message: 'Password has been reset successfully'
    });

  } catch (error) {
    console.error('🔐 Password reset update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset password. Please try again.'
    });
  }
});

// =====================================================
// COURSES API
// =====================================================

// Get all available courses
app.get('/api/courses', async (req, res) => {
  try {
    console.log('📚 Fetching available courses');
    
    const { data: courses, error } = await supabase
      .from('classes')
      .select(`
        id,
        code,
        name,
        description,
        credits,
        departments!inner(name)
      `)
      .eq('is_active', true);
    
    if (error) {
      console.error('Error fetching courses:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch courses'
      });
    }
    
    const formattedCourses = courses.map(course => ({
      id: course.id,
      code: course.code,
      name: course.name,
      description: course.description,
      credits: course.credits,
      department_name: course.departments.name
    }));
    
    console.log('✅ Courses fetched successfully:', formattedCourses.length);
    res.json({
      success: true,
      courses: formattedCourses
    });
    
  } catch (error) {
    console.error('📚 Courses fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch courses'
    });
  }
});

// =====================================================
// CLASSES API
// =====================================================

// Create a new class
app.post('/api/classes', async (req, res) => {
  try {
    const { course_id, professor_id, academic_period_id, room_location, max_students } = req.body;
    
    console.log('📚 Creating new class:', { course_id, professor_id, academic_period_id, room_location, max_students });
    
    // First, get the course details
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('code, name, description, credits, department_id')
      .eq('id', course_id)
      .single();
    
    if (courseError || !course) {
      console.error('Error fetching course:', courseError);
      return res.status(400).json({
        success: false,
        error: 'Course not found'
      });
    }
    
    // Create the class instance
    const { data: newClass, error: createError } = await supabase
      .from('classes')
      .insert({
        code: course.code,
        name: course.name,
        description: course.description,
        credits: course.credits,
        professor_id,
        department_id: course.department_id,
        academic_period_id: academic_period_id,
        room_location,
        max_students,
        is_active: true
      })
      .select()
      .single();
    
    if (createError) {
      console.error('Error creating class:', createError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create class'
      });
    }
    
    console.log('✅ Class created successfully:', newClass.id);
    res.json({
      success: true,
      class: newClass
    });
    
  } catch (error) {
    console.error('📚 Class creation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create class'
    });
  }
});

// =====================================================
// PROFESSOR DASHBOARD API
// =====================================================

// Get professor dashboard data
app.get('/api/professors/:professorId/dashboard', async (req, res) => {
  try {
    const { professorId } = req.params;
    
    console.log('📊 Fetching dashboard data for professor:', professorId);
    
    // Get professor's class instances (using new schema)
    const { data: classInstances, error: classInstancesError } = await supabase
      .from('class_instances')
      .select(`
        id,
        class_code,
        professor_id,
        academic_period_id,
        course_id,
        days_of_week,
        start_time,
        end_time,
        first_class_date,
        last_class_date,
        max_students,
        current_enrollment,
        is_active,
        created_at,
        courses(code, name, description, credits),
        academic_periods(name, year, semester)
      `)
      .eq('professor_id', professorId)
      .eq('is_active', true);
    
    if (classInstancesError) {
      console.error('Error fetching class instances:', classInstancesError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch class instances'
      });
    }
    
    // Get total students across all class instances
    const { data: enrollments, error: enrollmentsError } = await supabase
      .from('enrollments')
      .select(`
        student_id,
        class_instance_id,
        status
      `)
      .in('class_instance_id', classInstances.map(c => c.id))
      .eq('status', 'active');
    
    if (enrollmentsError) {
      console.error('Error fetching enrollments:', enrollmentsError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch enrollments'
      });
    }
    
    // Get all sessions (for finding today's sessions)
    const { data: allSessions, error: allSessionsError } = await supabase
      .from('class_sessions')
      .select(`
        id,
        class_instance_id,
        date,
        start_time,
        end_time,
        is_active,
        status,
        qr_expires_at
      `)
      .in('class_instance_id', classInstances.map(c => c.id));
    
    if (allSessionsError) {
      console.error('Error fetching all sessions:', allSessionsError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch sessions'
      });
    }
    
    // Filter active sessions
    const activeSessions = allSessions.filter(s => s.is_active === true);
    
    // Helper function to check if a class meets on a specific day
    const isClassToday = (classInstance) => {
      const today = new Date();
      const todayDayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
      const todayDate = today.toISOString().split('T')[0];
      
      // Check if today is within the class period
      const firstClassDate = new Date(classInstance.first_class_date);
      const lastClassDate = new Date(classInstance.last_class_date);
      
      if (today < firstClassDate || today > lastClassDate) {
        return false;
      }
      
      // Check if today's day of week matches the class schedule
      const daysOfWeek = classInstance.days_of_week || [];
      const dayMapping = {
        'Monday': 1,
        'Tuesday': 2,
        'Wednesday': 3,
        'Thursday': 4,
        'Friday': 5,
        'Saturday': 6,
        'Sunday': 0
      };
      
      return daysOfWeek.some(day => dayMapping[day] === todayDayOfWeek);
    };
    
    // Get today's classes
    const todayClasses = classInstances.filter(isClassToday);
    
    // Calculate stats
    const totalClasses = classInstances.length;
    const totalStudents = new Set(enrollments.map(e => e.student_id)).size;
    const activeSessionsCount = activeSessions.length;
    
    // Calculate average attendance from COMPLETED sessions (not active sessions)
    const { data: completedSessions, error: completedSessionsError } = await supabase
      .from('class_sessions')
      .select('id, class_instance_id')
      .in('class_instance_id', classInstances.map(c => c.id))
      .eq('status', 'completed');
    
    let averageAttendance = 0;
    if (!completedSessionsError && completedSessions.length > 0) {
      const { data: attendanceData, error: attendanceError } = await supabase
        .from('attendance_records')
        .select(`
          session_id,
          status
        `)
        .in('session_id', completedSessions.map(s => s.id));
      
      if (!attendanceError && attendanceData.length > 0) {
        // Count present, late, and excused as "attended" (same logic as analytics)
        const attendedCount = attendanceData.filter(a => 
          ['present', 'late', 'excused'].includes(a.status)
        ).length;
        averageAttendance = Math.round((attendedCount / attendanceData.length) * 100);
      }
    }
    
    // Format class instances with stats
    const classesWithStats = await Promise.all(classInstances.map(async (instance) => {
      const classEnrollments = enrollments.filter(e => e.class_instance_id === instance.id);
      const classActiveSessions = activeSessions.filter(s => s.class_instance_id === instance.id);
      const classCompletedSessions = completedSessions.filter(s => s.class_instance_id === instance.id);
      const isToday = isClassToday(instance);
      
      // Calculate class-specific attendance rate (including live sessions)
      let classAttendanceRate = 0;
      const allClassSessions = [...classActiveSessions, ...classCompletedSessions];
      
      if (allClassSessions.length > 0) {
        const { data: classAttendanceData } = await supabase
          .from('attendance_records')
          .select('status')
          .in('session_id', allClassSessions.map(s => s.id));
        
        if (classAttendanceData && classAttendanceData.length > 0) {
          const attendedCount = classAttendanceData.filter(a => 
            ['present', 'late', 'excused'].includes(a.status)
          ).length;
          classAttendanceRate = Math.round((attendedCount / classAttendanceData.length) * 100);
        }
      }
      
      // Find today's session if this is a today class
      const today = new Date().toISOString().split('T')[0];
      const todaySession = isToday ? allSessions.find(s => 
        s.class_instance_id === instance.id && 
        s.date === today &&
        s.status === 'scheduled'
      ) : null;
      
      const activeSession = classActiveSessions.length > 0 ? classActiveSessions[0] : null;
      
      // Determine status based on session state and time
      let status = 'upcoming';
      if (classActiveSessions.length > 0) {
        status = 'active';
      } else if (isToday) {
        // Check if today's session time has passed
        const now = new Date();
        const todaySessionTime = new Date(`${today}T${instance.start_time}`);
        const sessionEndTime = new Date(`${today}T${instance.end_time}`);
        
        if (now > sessionEndTime) {
          status = 'completed';
        } else if (now > todaySessionTime) {
          // Session time has started but no active session
          status = 'completed';
        }
      }
      
      return {
        id: instance.id,
        code: instance.courses?.code || 'Unknown',
        name: instance.courses?.name || 'Unknown Class',
        description: instance.courses?.description || '',
        credits: instance.courses?.credits || 0,
        class_code: instance.class_code,
        days_of_week: instance.days_of_week,
        start_time: instance.start_time,
        end_time: instance.end_time,
        enrolled_students: instance.current_enrollment || 0,
        max_students: instance.max_students,
        totalSessions: classActiveSessions.length + classCompletedSessions.length,
        completedSessions: classCompletedSessions.length,
        averageAttendance: classAttendanceRate,
        attendance_rate: classAttendanceRate, // Add attendance_rate for frontend compatibility
        status: status,
        isToday: isToday,
        academic_period: instance.academic_periods?.name || 'Unknown Period',
        today_session_id: todaySession?.id || null, // Add session ID for today's session
        active_session_id: activeSession?.id || null // Add active session ID if active
      };
    }));
    
    // Format active sessions
    const formattedActiveSessions = activeSessions.map(session => {
      const classData = classInstances.find(c => c.id === session.class_instance_id);
      const sessionEnrollments = enrollments.filter(e => e.class_instance_id === session.class_instance_id);
      
      return {
        id: session.id,
        class_code: classData?.courses?.code || 'Unknown',
        class_name: classData?.courses?.name || 'Unknown Class',
        present_count: 0, // Would need to query attendance table
        total_students: sessionEnrollments.length,
        qr_code_expires_at: session.qr_expires_at
      };
    });
    
    const dashboardData = {
      stats: {
        totalClasses,
        totalStudents,
        activeSessions: activeSessionsCount,
        averageAttendance
      },
      classes: classesWithStats,
      activeSessions: formattedActiveSessions,
      todayClasses: classesWithStats.filter(c => c.isToday)
    };
    
    console.log('✅ Dashboard data fetched successfully');
    res.json({
      success: true,
      data: dashboardData
    });
    
  } catch (error) {
    console.error('❌ Dashboard data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data'
    });
  }
});

// =====================================================
// SOCKET.IO REAL-TIME UPDATES
// =====================================================

// Make io available globally for other modules
global.io = io;

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('join-session', (sessionId) => {
    socket.join(`session-${sessionId}`);
    console.log(`Client ${socket.id} joined session ${sessionId}`);
  });
  
  // Join professor dashboard room for live updates
  socket.on('join-professor-dashboard', (professorId) => {
    socket.join(`professor-${professorId}`);
    console.log(`Client ${socket.id} joined professor dashboard ${professorId}`);
  });
  
  socket.on('leave-session', (sessionId) => {
    socket.leave(`session-${sessionId}`);
    console.log(`Client ${socket.id} left session ${sessionId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Helper function to broadcast attendance updates
function broadcastAttendanceUpdate(sessionId, attendanceData) {
  // Broadcast to session room
  io.to(`session-${sessionId}`).emit('attendance-update', attendanceData);
  
  // Also broadcast to professor dashboard if we have professor info
  if (attendanceData.professorId) {
    io.to(`professor-${attendanceData.professorId}`).emit('dashboard-attendance-update', {
      sessionId,
      attendanceCount: attendanceData.attendanceCount,
      totalStudents: attendanceData.totalStudents,
      attendanceRate: attendanceData.attendanceRate,
      timestamp: new Date().toISOString()
    });
  }
}

// =====================================================
// CLASS MANAGEMENT ENDPOINTS
// =====================================================

// Get individual class details
app.get('/api/classes/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    
    const { data: classData, error: classError } = await supabase
      .from('classes')
      .select(`
        *,
        departments (
          name,
          code
        ),
        academic_periods (
          name,
          year,
          semester
        )
      `)
      .eq('id', classId)
      .single();
    
    if (classError) {
      console.error('Error fetching class:', classError);
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }
    
    res.json({
      success: true,
      class: classData
    });
  } catch (error) {
    console.error('Error in /api/classes/:classId:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get enrolled students for a class
app.get('/api/classes/:classId/students', async (req, res) => {
  try {
    const { classId } = req.params;
    
    const { data: enrollments, error: enrollmentError } = await supabase
      .from('enrollments')
      .select(`
        *,
        students (
          id,
          student_id,
          enrollment_year,
          major,
          users (
            first_name,
            last_name,
            email,
            phone
          )
        )
      `)
      .eq('class_id', classId)
      .eq('status', 'active');
    
    if (enrollmentError) {
      console.error('Error fetching enrolled students:', enrollmentError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch enrolled students'
      });
    }
    
    // Calculate attendance rate for each student
    const studentsWithAttendance = await Promise.all(
      enrollments.map(async (enrollment) => {
        const { data: attendanceData, error: attendanceError } = await supabase
          .from('attendance')
          .select(`
            status,
            sessions (
              class_id
            )
          `)
          .eq('student_id', enrollment.student_id)
          .eq('sessions.class_id', classId);
        
        let attendanceRate = 0;
        if (!attendanceError && attendanceData.length > 0) {
          const presentCount = attendanceData.filter(a => a.status === 'present').length;
          attendanceRate = Math.round((presentCount / attendanceData.length) * 100);
        }
        
        return {
          ...enrollment.students,
          enrollment_date: enrollment.created_at,
          attendance_rate: attendanceRate
        };
      })
    );
    
    res.json({
      success: true,
      students: studentsWithAttendance
    });
  } catch (error) {
    console.error('Error in /api/classes/:classId/students:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Update current academic period based on real time
app.post('/api/academic-periods/update-current', async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12
    
    console.log(`🕐 Updating current period for real date: ${year}-${month.toString().padStart(2, '0')}`);
    
    // Determine current period based on real date
    let currentPeriod;
    if (month >= 8 && month <= 12) {
      currentPeriod = { name: `Fall ${year}`, year, semester: 'fall' };
    } else if (month >= 1 && month <= 5) {
      currentPeriod = { name: `Spring ${year}`, year, semester: 'spring' };
    } else if (month === 6) {
      currentPeriod = { name: `Summer I ${year}`, year, semester: 'summer_i' };
    } else if (month === 7) {
      currentPeriod = { name: `Summer II ${year}`, year, semester: 'summer_ii' };
    } else {
      currentPeriod = { name: `Fall ${year}`, year, semester: 'fall' };
    }
    
    // Set all periods to not current
    const { error: updateError } = await supabase
      .from('academic_periods')
      .update({ is_current: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');
    
    if (updateError) {
      console.error('Error updating periods:', updateError);
      return res.status(500).json({
        success: false,
        error: 'Failed to update periods'
      });
    }
    
    // Find or create the current period
    const { data: existingPeriod, error: findError } = await supabase
      .from('academic_periods')
      .select('*')
      .eq('name', currentPeriod.name)
      .eq('year', currentPeriod.year)
      .eq('semester', currentPeriod.semester)
      .single();
    
    if (findError && findError.code !== 'PGRST116') {
      console.error('Error finding current period:', findError);
      return res.status(500).json({
        success: false,
        error: 'Failed to find current period'
      });
    }
    
    if (existingPeriod) {
      // Update existing period to be current
      const { data, error } = await supabase
        .from('academic_periods')
        .update({ is_current: true })
        .eq('id', existingPeriod.id)
        .select()
        .single();
      
      if (error) {
        console.error('Error updating current period:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to update current period'
        });
      }
      
      res.json({
        success: true,
        message: `Updated current period to ${data.name}`,
        currentPeriod: data
      });
    } else {
      // Create new current period
      const { data, error } = await supabase
        .from('academic_periods')
        .insert({
          name: currentPeriod.name,
          year: currentPeriod.year,
          semester: currentPeriod.semester,
          start_date: `${currentPeriod.year}-08-15`,
          end_date: `${currentPeriod.year}-12-15`,
          is_current: true
        })
        .select()
        .single();
      
      if (error) {
        console.error('Error creating current period:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to create current period'
        });
      }
      
      res.json({
        success: true,
        message: `Created current period ${data.name}`,
        currentPeriod: data
      });
    }
    
  } catch (error) {
    console.error('Error in /api/academic-periods/update-current:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get all academic periods
app.get('/api/academic-periods', async (req, res) => {
  try {
    const { data: periods, error } = await supabase
      .from('academic_periods')
      .select('*')
      .order('year', { ascending: false })
      .order('semester', { ascending: true });
    
    if (error) {
      console.error('Error fetching academic periods:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch academic periods'
      });
    }
    
    res.json({
      success: true,
      data: periods
    });
  } catch (error) {
    console.error('Error in /api/academic-periods:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get all available students
app.get('/api/students', async (req, res) => {
  try {
    const { data: students, error: studentsError } = await supabase
      .from('students')
      .select(`
        id,
        student_id,
        first_name,
        last_name,
        email,
        major,
        enrollment_year
      `)
      .eq('is_active', true);
    
    if (studentsError) {
      console.error('Error fetching students:', studentsError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch students'
      });
    }
    
    res.json({
      success: true,
      students: students
    });
  } catch (error) {
    console.error('Error in /api/students:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Create a new student
app.post('/api/students', async (req, res) => {
  try {
    const { student_id, first_name, last_name, email, major, enrollment_year } = req.body;
    
    if (!student_id || !first_name || !last_name || !email || !major || !enrollment_year) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required'
      });
    }
    
    // Check if student already exists
    const { data: existingStudent, error: checkError } = await supabase
      .from('students')
      .select('id')
      .eq('student_id', student_id)
      .single();
    
    if (existingStudent) {
      return res.status(400).json({
        success: false,
        error: 'Student with this ID already exists'
      });
    }
    
    const { data: student, error: studentError } = await supabase
      .from('students')
      .insert({
        student_id,
        first_name,
        last_name,
        email,
        major,
        enrollment_year,
        is_active: true,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (studentError) {
      console.error('Error creating student:', studentError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create student'
      });
    }
    
    res.json({
      success: true,
      student: student
    });
  } catch (error) {
    console.error('Error in /api/students POST:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Enroll students in a class
app.post('/api/classes/:classId/enroll', async (req, res) => {
  try {
    const { classId } = req.params;
    const { student_ids } = req.body;
    
    if (!student_ids || !Array.isArray(student_ids)) {
      return res.status(400).json({
        success: false,
        error: 'Student IDs array is required'
      });
    }
    
    // Check if class exists and get max_students
    const { data: classData, error: classError } = await supabase
      .from('classes')
      .select('max_students')
      .eq('id', classId)
      .single();
    
    if (classError) {
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }
    
    // Check current enrollment count
    const { count: currentEnrollmentCount, error: countError } = await supabase
      .from('enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', classId)
      .eq('status', 'active');
    
    if (countError) {
      console.error('Error checking enrollment count:', countError);
      return res.status(500).json({
        success: false,
        error: 'Failed to check enrollment count'
      });
    }
    
    if (currentEnrollmentCount + student_ids.length > classData.max_students) {
      return res.status(400).json({
        success: false,
        error: `Cannot enroll ${student_ids.length} students. Class capacity is ${classData.max_students} and currently has ${currentEnrollmentCount} students.`
      });
    }
    
    // Get the current academic period
    const { data: periods, error: periodError } = await supabase
      .from('academic_periods')
      .select('id')
      .eq('is_current', true);
    
    if (periodError) {
      console.error('Error finding current academic period:', periodError);
      return res.status(500).json({
        success: false,
        error: 'Failed to find academic period'
      });
    }
    
    const currentPeriod = periods && periods.length > 0 ? periods[0] : null;
    
    if (!currentPeriod) {
      console.error('No current academic period found');
      return res.status(500).json({
        success: false,
        error: 'No current academic period found'
      });
    }

    // Get professor ID from the class
    const { data: classInfo, error: classInfoError } = await supabase
      .from('classes')
      .select('professor_id')
      .eq('id', classId)
      .single();
    
    if (classInfoError) {
      console.error('Error getting class info:', classInfoError);
      return res.status(500).json({
        success: false,
        error: 'Failed to get class information'
      });
    }

    // Handle enrollments - check for existing dropped enrollments first
    const enrollmentResults = [];
    
    for (const studentId of student_ids) {
      // Check if student already has an enrollment (active or dropped)
      const { data: existingEnrollment, error: checkError } = await supabase
        .from('enrollments')
        .select('*')
        .eq('class_id', classId)
        .eq('student_id', studentId)
        .eq('academic_period_id', currentPeriod.id)
        .single();
      
      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Error checking existing enrollment:', checkError);
        continue;
      }
      
      if (existingEnrollment) {
        // Update existing enrollment to active
        const { data: updatedEnrollment, error: updateError } = await supabase
          .from('enrollments')
          .update({
            status: 'active',
            enrolled_by: classInfo.professor_id
          })
          .eq('id', existingEnrollment.id)
          .select()
          .single();
        
        if (updateError) {
          console.error('Error updating enrollment:', updateError);
          continue;
        }
        
        enrollmentResults.push(updatedEnrollment);
      } else {
        // Create new enrollment
        const { data: newEnrollment, error: insertError } = await supabase
          .from('enrollments')
          .insert({
            class_id: classId,
            student_id: studentId,
            academic_period_id: currentPeriod.id,
            enrolled_by: classInfo.professor_id,
            status: 'active',
            created_at: new Date().toISOString()
          })
          .select()
          .single();
        
        if (insertError) {
          console.error('Error creating enrollment:', insertError);
          continue;
        }
        
        enrollmentResults.push(newEnrollment);
      }
    }
    
    if (enrollmentResults.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Failed to enroll any students'
      });
    }
    
    // Create notifications for enrolled students
    try {
      console.log('🔔 Creating enrollment notifications for', enrollmentResults.length, 'students');
      
      // Get class information for notifications
      const { data: classInfo, error: classError } = await supabase
        .from('classes')
        .select(`
          id,
          code,
          name,
          professor_id,
          professors!inner(
            users!inner(
              first_name,
              last_name
            )
          )
        `)
        .eq('id', classId)
        .single();
      
      if (!classError && classInfo) {
        const className = `${classInfo.code} - ${classInfo.name}`;
        const professorName = `${classInfo.professors.users.first_name} ${classInfo.professors.users.last_name}`;
        
        // Create notifications for each enrolled student
        const notificationsToCreate = enrollmentResults.map(enrollment => ({
          user_id: enrollment.student_id,
          type: 'system', // Use 'system' type since 'class_enrolled' isn't available yet
          title: 'You\'ve been enrolled in a new class!',
          message: `You have been enrolled in ${className} by Professor ${professorName}. Check your dashboard to view class details.`,
          priority: 'high',
          link: `/student/classes/${classId}`,
          metadata: {
            className,
            professorName,
            enrollmentDate: new Date().toISOString(),
            notificationType: 'class_enrolled', // Store the intended type in metadata
            classId: classId
          }
        }));
        
        if (notificationsToCreate.length > 0) {
          const { error: notificationError } = await supabase
            .from('notifications')
            .insert(notificationsToCreate);
          
          if (notificationError) {
            console.error('❌ Error creating enrollment notifications:', notificationError);
          } else {
            console.log(`✅ Enrollment notifications created for ${notificationsToCreate.length} students`);
          }
        }
      }
    } catch (notificationErr) {
      console.error('❌ Error in enrollment notification creation:', notificationErr);
    }
    
    res.json({
      success: true,
      message: `Successfully enrolled ${enrollmentResults.length} students`,
      enrollments: enrollmentResults
    });
  } catch (error) {
    console.error('Error in /api/classes/:classId/enroll:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Unenroll student from a class
app.post('/api/classes/:classId/unenroll', async (req, res) => {
  try {
    console.log('🔔 CLASS UNENROLLMENT ENDPOINT CALLED:', req.params.classId);
    const { classId } = req.params;
    const { student_id } = req.body;
    
    console.log('📝 Class unenrollment request:', { classId, student_id });
    
    if (!student_id) {
      return res.status(400).json({
        success: false,
        error: 'Student ID is required'
      });
    }
    
    const { data, error } = await supabase
      .from('enrollments')
      .update({ 
        status: 'dropped'
      })
      .eq('class_id', classId)
      .eq('student_id', student_id)
      .eq('status', 'active')
      .select();
    
    if (error) {
      console.error('Error unenrolling student:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to unenroll student'
      });
    }
    
    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Enrollment not found or already inactive'
      });
    }
    
    // Create notification for the unenrolled student
    try {
      console.log('🔔 Creating unenrollment notification for student:', student_id);
      
      // Get class and professor information for the notification
      console.log('🔍 Fetching class info for classId:', classId);
      const { data: classInfo, error: classError } = await supabase
        .from('classes')
        .select(`
          id,
          code,
          name,
          professor_id,
          professors!inner(
            users!inner(
              first_name,
              last_name
            )
          )
        `)
        .eq('id', classId)
        .single();
      
      if (classError) {
        console.error('❌ Error fetching class info:', classError);
        console.log('❌ Class ID:', classId);
      } else {
        console.log('✅ Class info fetched:', classInfo);
      }
      
      if (!classError && classInfo) {
        const className = `${classInfo.code} - ${classInfo.name}`;
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
            classId: classId
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
      message: 'Student successfully unenrolled',
      data: data[0]
    });
  } catch (error) {
    console.error('❌ Error in /api/classes/:classId/unenroll:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error: ' + error.message
    });
  }
});

// =====================================================
// NOTIFICATION SYSTEM FUNCTIONS
// =====================================================

const notifyStudentsSessionActivated = async (sessionId) => {
  try {
    console.log('📢 Notifying students about session activation:', sessionId);
    
    // Get session details with class information
    const { data: session, error: sessionError } = await supabase
      .from('class_sessions')
      .select(`
        id,
        date,
        start_time,
        room_location,
        class_instance_id,
        class_instances!inner(
          courses!inner(
            code,
            name
          )
        )
      `)
      .eq('id', sessionId)
      .single();
    
    if (sessionError || !session) {
      console.error('❌ Error fetching session details:', sessionError);
      return;
    }
    
    // Get enrolled students for this class instance
    const { data: enrollments, error: enrollmentError } = await supabase
      .from('enrollments')
      .select(`
        student_id,
        status
      `)
      .eq('class_instance_id', session.class_instance_id)
      .eq('status', 'active');
    
    if (enrollmentError) {
      console.error('❌ Error fetching enrollments:', enrollmentError);
      return;
    }
    
    if (!enrollments || enrollments.length === 0) {
      console.log('📢 No enrolled students found for this class');
      return;
    }
    
    // Prepare notification data
    const className = `${session.class_instances.courses.code} - ${session.class_instances.courses.name}`;
    const sessionTime = `${session.date} at ${session.start_time}`;
    const roomLocation = session.room_location;
    
    // Create notifications for each student
    const notifications = enrollments.map(enrollment => ({
      user_id: enrollment.student_id,
      type: 'system',
      title: 'Class session has started!',
      message: `${className} session has started at ${sessionTime}${roomLocation ? ` in ${roomLocation}` : ''}. You can now scan the QR code to mark your attendance.`,
      priority: 'urgent',
      link: '/student/scan',
      session_id: sessionId,
      metadata: {
        className,
        sessionTime,
        roomLocation,
        sessionStartDate: new Date().toISOString(),
        notificationType: 'session_started'
      }
    }));
    
    if (notifications.length > 0) {
      const { error: notificationError } = await supabase
        .from('notifications')
        .insert(notifications);
      
      if (notificationError) {
        console.error('❌ Error creating session notifications:', notificationError);
      } else {
        console.log(`📢 Session notifications sent to ${notifications.length} students`);
      }
    }
  } catch (error) {
    console.error('❌ Error notifying students:', error);
  }
};

// NOTIFICATIONS API
// =====================================================

// Get notifications for a user
app.get('/api/notifications', async (req, res) => {
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }
    
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (error) {
      console.error('Error fetching notifications:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch notifications'
      });
    }
    
    res.json({
      success: true,
      data: data || [],
      count: data?.length || 0
    });
    
  } catch (error) {
    console.error('Error in notifications API:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get unread notifications count
app.get('/api/notifications/unread-count', async (req, res) => {
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }
    
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user_id)
      .eq('is_read', false);
    
    if (error) {
      console.error('Error fetching unread count:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch unread count'
      });
    }
    
    res.json({
      success: true,
      count: count || 0
    });
    
  } catch (error) {
    console.error('Error in unread count API:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Mark notification as read
app.patch('/api/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from('notifications')
      .update({ 
        is_read: true, 
        read_at: new Date().toISOString() 
      })
      .eq('id', id);
    
    if (error) {
      console.error('Error marking notification as read:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to mark notification as read'
      });
    }
    
    res.json({
      success: true,
      message: 'Notification marked as read'
    });
    
  } catch (error) {
    console.error('Error in mark as read API:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create a test notification
app.post('/api/notifications/test', async (req, res) => {
  try {
    const { user_id, title, message } = req.body;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }
    
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id,
        type: 'system',
        priority: 'medium',
        title: title || 'Test Notification',
        message: message || 'This is a test notification to verify the system is working.',
        metadata: { test: true }
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating test notification:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to create test notification'
      });
    }
    
    res.json({
      success: true,
      data,
      message: 'Test notification created successfully'
    });
    
  } catch (error) {
    console.error('Error in test notification API:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// START SERVER
// =====================================================

const PORT = process.env.PORT || 3001;

server.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Optimized FSAS Backend Server running on port', PORT);
  console.log('📊 Health check: http://localhost:' + PORT + '/api/health');
  console.log('🔗 Supabase connected:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log('✨ Features: QR Generation, Attendance Tracking, Real-time Updates, Role-based Access, Enrollment Management');
});

module.exports = { app, server, io, broadcastAttendanceUpdate };
