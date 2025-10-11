const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Create Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createTodayAttendanceRecords() {
  console.log('🚀 Creating attendance records for today...');

  try {
    const today = new Date().toISOString().split('T')[0];
    const testStudentUserId = '03cfe76e-57d1-41dc-89ee-079a69750f1e'; // user_id for student 5002378
    
    console.log('📅 Today:', today);
    console.log('👨‍🎓 Student user_id:', testStudentUserId);

    // Get a session for today
    const { data: sessions, error: sessionError } = await supabase
      .from('class_sessions')
      .select('*')
      .eq('date', today)
      .limit(1);

    let session;
    if (sessionError || !sessions || sessions.length === 0) {
      console.log('📝 No session for today, creating one...');
      
      // Get a class instance
      const { data: classInstances, error: classError } = await supabase
        .from('class_instances')
        .select('id, courses(code, name), start_time, end_time')
        .limit(1);

      if (classError || !classInstances || classInstances.length === 0) {
        console.error('❌ No class instances found');
        return;
      }

      const classInstance = classInstances[0];

      const { data: newSession, error: newSessionError } = await supabase
        .from('class_sessions')
        .insert({
          class_instance_id: classInstance.id,
          date: today,
          start_time: classInstance.start_time,
          end_time: classInstance.end_time,
          status: 'completed',
          session_number: 1,
          is_active: false,
          attendance_count: 0,
          total_enrolled: 1
        })
        .select()
        .single();

      if (newSessionError) {
        console.error('❌ Error creating session:', newSessionError);
        return;
      }

      session = newSession;
      console.log('✅ Created session:', session.id);
    } else {
      session = sessions[0];
      console.log('✅ Using existing session:', session.id);
    }

    // Create attendance records for today
    const attendanceRecords = [
      {
        session_id: session.id,
        student_id: testStudentUserId,
        scanned_at: `${today}T09:00:00.000Z`, // 9 AM today
        status: 'present',
        minutes_late: 0,
        device_fingerprint: 'test-device-present',
        ip_address: '127.0.0.1'
      },
      {
        session_id: session.id,
        student_id: testStudentUserId,
        scanned_at: `${today}T10:30:00.000Z`, // 10:30 AM today
        status: 'late',
        minutes_late: 8,
        device_fingerprint: 'test-device-late',
        ip_address: '127.0.0.1'
      },
      {
        session_id: session.id,
        student_id: testStudentUserId,
        scanned_at: `${today}T14:00:00.000Z`, // 2 PM today
        status: 'present',
        minutes_late: 0,
        device_fingerprint: 'test-device-present-2',
        ip_address: '127.0.0.1'
      }
    ];

    const { data: attendanceData, error: attendanceError } = await supabase
      .from('attendance_records')
      .insert(attendanceRecords)
      .select();

    if (attendanceError) {
      console.error('❌ Error creating attendance records:', attendanceError);
      return;
    }

    console.log('✅ Created attendance records:', attendanceData.length);

    // Update session attendance count
    await supabase
      .from('class_sessions')
      .update({ attendance_count: attendanceData.length })
      .eq('id', session.id);

    console.log('✅ Updated session attendance count');

    // Test the stats API
    console.log('🧪 Testing stats API...');
    const statsResponse = await fetch('http://localhost:3001/api/attendance/student/5002378/today-stats');
    const stats = await statsResponse.json();
    
    console.log('📊 Today\'s stats:', JSON.stringify(stats, null, 2));

    console.log('🎉 Today\'s attendance data created successfully!');
    console.log('\n📋 Summary:');
    console.log(`• Session: ${session.id}`);
    console.log(`• Attendance records created: ${attendanceData.length}`);
    console.log(`• Date: ${today}`);
    console.log(`• Present: ${stats.stats.present}`);
    console.log(`• Late: ${stats.stats.late}`);
    console.log(`• Total scans: ${stats.stats.scansToday}`);

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

createTodayAttendanceRecords().then(() => {
  console.log('\n✅ Done! Check the scan page now.');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Failed:', error);
  process.exit(1);
});
