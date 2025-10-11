const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

// Create Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Get classes for a specific student
 * GET /api/students/:studentId/classes
 */
router.get('/api/students/:studentId/classes', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    // Get student's enrollments with class details
    const { data: enrollments, error: enrollmentError } = await supabase
      .from('enrollments')
      .select(`
        *,
        class_instances!inner(
          id,
          room_location,
          max_students,
          current_enrollment,
          days_of_week,
          start_time,
          end_time,
          first_class_date,
          last_class_date,
          course_id,
          professor_id,
          academic_period_id,
          courses!inner(
            code,
            name,
            description,
            credits
          ),
          academic_periods!inner(
            name,
            year,
            semester
          )
        )
      `)
      .eq('student_id', studentId)
      .eq('status', 'active');
    
    if (enrollmentError) {
      console.error('❌ Error fetching student classes:', enrollmentError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch student classes'
      });
    }
    
    // Get one sample session per class for fallback times/room
    const sessionsByClassId = {};
    const classInstanceIds = enrollments.map(e => e.class_instance_id).filter(Boolean);
    if (classInstanceIds.length > 0) {
      const { data: sampleSessions } = await supabase
        .from('class_sessions')
        .select('class_instance_id, start_time, end_time, room_location, date')
        .in('class_instance_id', classInstanceIds)
        .order('date', { ascending: true });
      if (Array.isArray(sampleSessions)) {
        for (const s of sampleSessions) {
          if (!sessionsByClassId[s.class_instance_id]) sessionsByClassId[s.class_instance_id] = s;
        }
      }
    }

    // Get today sessions to compute meets_today reliably
    const todayIso = new Date().toISOString().split('T')[0];
    const meetsTodaySet = new Set();
    if (classInstanceIds.length > 0) {
      const { data: todaySessions } = await supabase
        .from('class_sessions')
        .select('class_instance_id')
        .in('class_instance_id', classInstanceIds)
        .eq('date', todayIso);
      if (Array.isArray(todaySessions)) {
        for (const t of todaySessions) {
          meetsTodaySet.add(t.class_instance_id);
        }
      }
    }

    // Get attendance statistics for each class
    const classesWithStats = await Promise.all(
      enrollments.map(async (enrollment) => {
        const classInstance = enrollment.class_instances || null;
        const courseData = classInstance?.courses || null;
        const academicPeriod = classInstance?.academic_periods || null;
        const sessions = sessionsByClassId[enrollment.class_instance_id] ? [sessionsByClassId[enrollment.class_instance_id]] : [];
        
        // Get attendance records for this student in this class
        const { data: attendanceRecords, error: attendanceError } = await supabase
          .from('attendance_records')
          .select(`
            status,
            class_sessions!inner(
              class_instance_id
            )
          `)
          .eq('student_id', studentId)
          .eq('class_sessions.class_instance_id', enrollment.class_instance_id);
        
        let attendanceRate = 0;
        let attendedSessions = 0;
        let totalSessionsWithAttendance = 0;
        
        // Get all completed sessions where professor took attendance
        const { data: completedSessions, error: completedSessionsError } = await supabase
          .from('class_sessions')
          .select('id, status, attendance_count')
          .eq('class_instance_id', enrollment.class_instance_id)
          .eq('status', 'completed')
          .gt('attendance_count', 0);
        
        if (!completedSessionsError && completedSessions) {
          // Count sessions where professor took attendance
          totalSessionsWithAttendance = completedSessions.length;
          // Count sessions where student was present, late, or excused
          attendedSessions = attendanceRecords ? attendanceRecords.filter(record => 
            record.status === 'present' || record.status === 'late' || record.status === 'excused'
          ).length : 0;
          // Calculate attendance rate based on sessions where professor took attendance
          attendanceRate = totalSessionsWithAttendance > 0 ? Math.round((attendedSessions / totalSessionsWithAttendance) * 100) : 0;
        }
        
        // Get total sessions for this class instance (for display purposes)
        const { data: totalSessionsData, error: totalSessionsError } = await supabase
          .from('class_sessions')
          .select('id')
          .eq('class_instance_id', enrollment.class_instance_id);
        
        const actualTotalSessions = totalSessionsData?.length || 0;
        
        // Compute meets_today based on days_of_week and date range
        let meetsToday = meetsTodaySet.has(enrollment.class_instance_id);
        if (!meetsToday) {
          try {
            const today = new Date();
            const todayName = today.toLocaleDateString('en-US', { weekday: 'long' });
            const withinRange = classInstance?.first_class_date && classInstance?.last_class_date
              ? (todayIso >= classInstance.first_class_date && todayIso <= classInstance.last_class_date)
              : true;
            const matchesDay = Array.isArray(classInstance?.days_of_week)
              ? classInstance.days_of_week.includes(todayName)
              : false;
            meetsToday = withinRange && matchesDay;
          } catch (_) {}
        }

        // Use class instance data if available, otherwise fall back
        let roomLocation = 'TBD';
        if (classInstance?.room_location) {
          roomLocation = classInstance.room_location;
        } else if (sessions && sessions.length > 0 && sessions[0].room_location) {
          roomLocation = sessions[0].room_location;
        }
        
                let scheduleInfo = academicPeriod ? `${academicPeriod.semester} ${academicPeriod.year}` : 'TBD';
                if (classInstance?.schedule_info) {
                  scheduleInfo = classInstance.schedule_info;
                } else if (classInstance?.days_of_week && classInstance?.start_time && classInstance?.end_time) {
                  // Build schedule from days_of_week, start_time, end_time
                  const days = Array.isArray(classInstance.days_of_week) ? classInstance.days_of_week.join('') : classInstance.days_of_week;
                  scheduleInfo = `${days} ${classInstance.start_time}-${classInstance.end_time}`;
                } else if (sessions && sessions.length > 0 && sessions[0].start_time && sessions[0].end_time) {
                  // Convert 24-hour to 12-hour format for consistency and include actual days if available
                  const startTime = sessions[0].start_time;
                  const endTime = sessions[0].end_time;
                  const startHour = parseInt(startTime.split(':')[0]);
                  const startMin = startTime.split(':')[1];
                  const endHour = parseInt(endTime.split(':')[0]);
                  const endMin = endTime.split(':')[1];

                  const startPeriod = startHour >= 12 ? 'PM' : 'AM';
                  const endPeriod = endHour >= 12 ? 'PM' : 'AM';
                  const startHour12 = startHour > 12 ? startHour - 12 : startHour === 0 ? 12 : startHour;
                  const endHour12 = endHour > 12 ? endHour - 12 : endHour === 0 ? 12 : endHour;

                  const dayAbbrev = (d) => {
                    const map = { Sunday: 'Sun', Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat' };
                    return map[d] || d;
                  };
                  let daysLabel = 'Days';
                  if (classInstance?.days_of_week) {
                    if (Array.isArray(classInstance.days_of_week)) {
                      daysLabel = classInstance.days_of_week.map(dayAbbrev).join('/');
                    } else if (typeof classInstance.days_of_week === 'string') {
                      // Keep provided encoding (e.g., MWF/TR) but normalize common values
                      const enc = classInstance.days_of_week;
                      if (/MWF/i.test(enc)) daysLabel = 'Mon/Wed/Fri';
                      else if (/(TR|TTh)/i.test(enc)) daysLabel = 'Tue/Thu';
                      else daysLabel = enc;
                    }
                  }

                  scheduleInfo = `${daysLabel} ${startHour12}:${startMin} ${startPeriod} - ${endHour12}:${endMin} ${endPeriod}`;
                }
        
        const maxStudents = classInstance?.max_students || 30;
        const currentEnrollment = classInstance?.current_enrollment || 0;
        
        // Get professor info
        const { data: professorUser } = await supabase
          .from('users')
          .select('first_name, last_name, email')
          .eq('id', classInstance?.professor_id)
          .single();
        
        return {
          id: enrollment.class_instance_id,
          class_id: classInstance?.id || enrollment.class_instance_id,
          class_code: courseData?.code || 'N/A',
          class_name: courseData?.name || 'Unknown Class',
          description: courseData?.description || '',
          credits: courseData?.credits || 0,
          professor: professorUser ? `${professorUser.first_name} ${professorUser.last_name}` : 'Unknown Professor',
          professor_email: professorUser?.email || '',
          room: roomLocation,
          schedule: scheduleInfo,
          // Structured scheduling fields for reliable client-side filtering
          days_of_week: classInstance?.days_of_week || null,
          start_time: classInstance?.start_time || (sessions && sessions[0]?.start_time) || null,
          end_time: classInstance?.end_time || (sessions && sessions[0]?.end_time) || null,
          first_class_date: classInstance?.first_class_date || null,
          last_class_date: classInstance?.last_class_date || null,
          meets_today: meetsToday,
          academic_period: academicPeriod?.name || 'Unknown Period',
          enrollment_date: enrollment.enrollment_date,
          attendance_rate: attendanceRate,
          total_sessions: totalSessionsWithAttendance,
          attended_sessions: attendedSessions,
          max_students: maxStudents,
          current_enrollment: currentEnrollment
        };
      })
    );
    
    res.json({
      success: true,
      classes: classesWithStats,
      count: classesWithStats.length
    });
    
  } catch (error) {
    console.error('❌ Error in /api/students/:studentId/classes:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get class statistics for a student
 * GET /api/students/:studentId/classes/stats
 */
router.get('/api/students/:studentId/classes/stats', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    // Get basic enrollment count
    const { data: enrollments, error: enrollmentError } = await supabase
      .from('enrollments')
      .select(`
        *,
        class_instances!inner(
          id,
          is_active
        )
      `)
      .eq('student_id', studentId)
      .eq('status', 'active')
      .eq('class_instances.is_active', true);
    
    if (enrollmentError) {
      console.error('❌ Error fetching enrollment stats:', enrollmentError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch enrollment statistics'
      });
    }
    
    const totalClasses = enrollments.length;
    
    // Calculate average attendance across all classes
    let totalAttendanceRate = 0;
    let classesWithAttendance = 0;
    
    for (const enrollment of enrollments) {
      const { data: attendanceRecords } = await supabase
        .from('attendance_records')
        .select(`
          status,
          class_sessions!inner(
            class_instance_id
          )
        `)
        .eq('student_id', studentId)
        .eq('class_sessions.class_instance_id', enrollment.class_instances.id);
      
      if (attendanceRecords && attendanceRecords.length > 0) {
        const attendedSessions = attendanceRecords.filter(record => 
          record.status === 'present' || record.status === 'late'
        ).length;
        const attendanceRate = Math.round((attendedSessions / attendanceRecords.length) * 100);
        totalAttendanceRate += attendanceRate;
        classesWithAttendance++;
      }
    }
    
    const averageAttendance = classesWithAttendance > 0 
      ? Math.round(totalAttendanceRate / classesWithAttendance) 
      : 0;
    
    // Get today's classes (simplified - just count active enrollments)
    const upcomingClasses = totalClasses; // For now, just show total active classes
    
    res.json({
      success: true,
      stats: {
        totalClasses,
        averageAttendance,
        favoriteClasses: 0, // Not implemented
        upcomingClasses
      }
    });
    
  } catch (error) {
    console.error('❌ Error in /api/students/:studentId/classes/stats:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;
