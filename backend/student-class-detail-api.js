const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

// Create Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Get detailed class information for a student
 * GET /api/students/:studentId/classes/:classInstanceId
 */
router.get('/api/students/:studentId/classes/:classId', async (req, res) => {
  try {
    const { studentId, classId } = req.params;
    
    console.log('🔍 Getting class details for student:', studentId, 'class:', classId);
    
    // Get class details from class_instances table
    const { data: classData, error: classError } = await supabase
      .from('class_instances')
      .select(`
        id,
        class_code,
        room_location,
        max_students,
        current_enrollment,
        courses!inner(
          id,
          code,
          name,
          description,
          credits
        ),
        professors!inner(
          users!inner(
            first_name,
            last_name,
            email
          )
        ),
        academic_periods!inner(
          name,
          year,
          semester
        )
      `)
      .eq('id', classId)
      .single();
    
    if (classError || !classData) {
      console.error('❌ Error fetching class:', classError);
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }
    
    // Get the class_instance_id from the enrollment
    const { data: enrollment, error: enrollmentError } = await supabase
      .from('enrollments')
      .select('class_instance_id')
      .eq('student_id', studentId)
      .eq('class_instance_id', classId)
      .single();
    
    if (enrollmentError || !enrollment) {
      console.error('❌ Error fetching enrollment:', enrollmentError);
      return res.status(404).json({
        success: false,
        error: 'Enrollment not found'
      });
    }
    
    // Get all class sessions for this class instance
    const { data: sessions, error: sessionsError } = await supabase
      .from('class_sessions')
      .select(`
        id,
        session_number,
        date,
        start_time,
        end_time,
        room_location,
        status,
        notes,
        is_active,
        attendance_count,
        total_enrolled
      `)
      .eq('class_instance_id', enrollment.class_instance_id)
      .order('date', { ascending: true });
    
    if (sessionsError) {
      console.error('❌ Error fetching class sessions:', sessionsError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch class sessions'
      });
    }
    
    // Get the most common room and schedule from sessions
    let actualRoom = 'TBD';
    let actualSchedule = 'TBD';
    
    if (sessions && sessions.length > 0) {
      // Get the most common room location
      const roomCounts = {};
      sessions.forEach(session => {
        if (session.room_location) {
          roomCounts[session.room_location] = (roomCounts[session.room_location] || 0) + 1;
        }
      });
      actualRoom = Object.keys(roomCounts).reduce((a, b) => roomCounts[a] > roomCounts[b] ? a : b, 'TBD');
      
      // Get the most common schedule pattern
      const timeCounts = {};
      sessions.forEach(session => {
        if (session.start_time && session.end_time) {
          const timeKey = `${session.start_time}-${session.end_time}`;
          timeCounts[timeKey] = (timeCounts[timeKey] || 0) + 1;
        }
      });
      const mostCommonTime = Object.keys(timeCounts).reduce((a, b) => timeCounts[a] > timeCounts[b] ? a : b, '');
      
      if (mostCommonTime) {
        const [startTime, endTime] = mostCommonTime.split('-');
        // Convert 24-hour to 12-hour format
        const startHour = parseInt(startTime.split(':')[0]);
        const startMin = startTime.split(':')[1];
        const endHour = parseInt(endTime.split(':')[0]);
        const endMin = endTime.split(':')[1];
        
        const startPeriod = startHour >= 12 ? 'PM' : 'AM';
        const endPeriod = endHour >= 12 ? 'PM' : 'AM';
        const startHour12 = startHour > 12 ? startHour - 12 : startHour === 0 ? 12 : startHour;
        const endHour12 = endHour > 12 ? endHour - 12 : endHour === 0 ? 12 : endHour;
        
        actualSchedule = `Mon/Wed ${startHour12}:${startMin} ${startPeriod} - ${endHour12}:${endMin} ${endPeriod}`;
      }
    }
    
    // Get attendance records for this student in this class
    const { data: attendanceRecords, error: attendanceError } = await supabase
      .from('attendance_records')
      .select(`
        id,
        status,
        scanned_at,
        minutes_late,
        status_change_reason,
        session_id,
        class_sessions!inner(
          id,
          session_number,
          date,
          start_time,
          end_time,
          class_instance_id,
          status
        )
      `)
      .eq('student_id', studentId)
      .eq('class_sessions.class_instance_id', enrollment.class_instance_id);
    
    if (attendanceError) {
      console.error('❌ Error fetching attendance records:', attendanceError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch attendance records'
      });
    }
    
    // Create a map of session ID to attendance record
    const attendanceMap = new Map();
    attendanceRecords.forEach(record => {
      attendanceMap.set(record.class_sessions.id, record);
    });
    
    // Combine sessions with attendance data
    const sessionsWithAttendance = sessions.map(session => {
      const attendance = attendanceMap.get(session.id);
      const isPast = new Date(session.date) < new Date();
      const isToday = new Date(session.date).toDateString() === new Date().toDateString();
      
      return {
        id: session.id,
        session_number: session.session_number,
        date: session.date,
        start_time: session.start_time,
        end_time: session.end_time,
        room_location: session.room_location || classData.room_location,
        status: session.status,
        notes: session.notes,
        is_active: session.is_active,
        attendance_count: session.attendance_count,
        total_enrolled: session.total_enrolled,
        is_past: isPast,
        is_today: isToday,
        attendance: attendance ? {
          status: attendance.status,
          scanned_at: attendance.scanned_at,
          minutes_late: attendance.minutes_late,
          status_change_reason: attendance.status_change_reason
        } : null
      };
    });
    
    // Separate past and upcoming sessions
    const pastSessions = sessionsWithAttendance.filter(s => s.is_past);
    const upcomingSessions = sessionsWithAttendance.filter(s => !s.is_past);
    
    // Calculate attendance statistics based on sessions where professor took attendance
    // A session should be counted if it has attendance records OR is completed with attendance_count > 0
    const sessionsWhereProfessorTookAttendance = pastSessions.filter(s => 
      s.attendance !== null || (s.status === 'completed' && s.attendance_count > 0)
    );
    const totalSessionsWithAttendance = sessionsWhereProfessorTookAttendance.length;
    const attendedSessions = sessionsWhereProfessorTookAttendance.filter(s => 
      s.attendance && (s.attendance.status === 'present' || s.attendance.status === 'late' || s.attendance.status === 'excused')
    ).length;
    const attendanceRate = totalSessionsWithAttendance > 0 ? Math.round((attendedSessions / totalSessionsWithAttendance) * 100) : 0;
    
    // Get enrollment info (we already have the enrollment from above)
    const { data: enrollmentInfo, error: enrollmentInfoError } = await supabase
      .from('enrollments')
      .select('enrollment_date, status')
      .eq('student_id', studentId)
      .eq('class_instance_id', classId)
      .single();
    
    const response = {
      success: true,
      class: {
        id: classData.id,
        class_code: classData.class_code,
        class_name: classData.courses.name,
        description: classData.courses.description,
        credits: classData.courses.credits,
        professor: `${classData.professors.users.first_name} ${classData.professors.users.last_name}`,
        professor_email: classData.professors.users.email,
        room: actualRoom,
        schedule: actualSchedule,
        academic_period: classData.academic_periods.name,
        max_students: classData.max_students,
        current_enrollment: classData.current_enrollment,
        enrollment_date: enrollmentInfo?.enrollment_date,
        enrollment_status: enrollmentInfo?.status
      },
      attendance_stats: {
        total_sessions: totalSessionsWithAttendance,
        attended_sessions: attendedSessions,
        attendance_rate: attendanceRate
      },
      past_sessions: pastSessions,
      upcoming_sessions: upcomingSessions
    };
    
    console.log('✅ Class details fetched successfully:', {
      class: response.class.class_name,
      pastSessions: pastSessions.length,
      upcomingSessions: upcomingSessions.length,
      attendanceRate: attendanceRate
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Error fetching class details:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
