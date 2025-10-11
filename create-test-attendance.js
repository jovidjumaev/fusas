const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Create Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createTestAttendanceData() {
  console.log('🚀 Creating test attendance data for today...');

  try {
    const today = new Date().toISOString().split('T')[0];
    const testStudentId = '03cfe76e-57d1-41dc-89ee-079a69750f1e';
    
    console.log('📅 Date:', today);
    console.log('👨‍🎓 Student ID:', testStudentId);

    // First, let's create a simple session for today
    console.log('📝 Creating a test session...');
    
    // Get a class instance
    const { data: classInstances, error: classError } = await supabase
      .from('class_instances')
      .select('id, courses(code, name), start_time, end_time')
      .limit(1);

    if (classError || !classInstances || classInstances.length === 0) {
      console.error('❌ No class instances found:', classError);
      return;
    }

    const classInstance = classInstances[0];
    console.log('📚 Using class:', classInstance.courses.code, '-', classInstance.courses.name);

    // Create a session for today
    const { data: session, error: sessionError } = await supabase
      .from('class_sessions')
      .insert({
        class_instance_id: classInstance.id,
        date: today,
        start_time: classInstance.start_time,
        end_time: classInstance.end_time,
        status: 'completed', // Mark as completed so we can have attendance records
        session_number: 1,
        is_active: false,
        attendance_count: 0,
        total_enrolled: 1
      })
      .select()
      .single();

    if (sessionError) {
      console.error('❌ Error creating session:', sessionError);
      return;
    }

    console.log('✅ Created session:', session.id);

    // Now create attendance records for this session
    console.log('📊 Creating attendance records...');
    
    const attendanceRecords = [
      {
        session_id: session.id,
        student_id: testStudentId,
        scanned_at: new Date().toISOString(),
        status: 'present',
        minutes_late: 0,
        device_fingerprint: 'test-device-present',
        ip_address: '127.0.0.1'
      },
      {
        session_id: session.id,
        student_id: testStudentId,
        scanned_at: new Date().toISOString(),
        status: 'late',
        minutes_late: 8,
        device_fingerprint: 'test-device-late',
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
      .update({ attendance_count: attendanceRecords.length })
      .eq('id', session.id);

    console.log('✅ Updated session attendance count');

    // Test the stats API
    console.log('🧪 Testing stats API...');
    const statsResponse = await fetch('http://localhost:3001/api/attendance/student/5002378/today-stats');
    const stats = await statsResponse.json();
    
    console.log('📊 Today\'s stats:', stats);

    console.log('🎉 Test data creation completed!');
    console.log('\n📋 Summary:');
    console.log(`• Session created: ${session.id}`);
    console.log(`• Attendance records created: ${attendanceData.length}`);
    console.log(`• Test student ID: ${testStudentId}`);
    console.log(`• Date: ${today}`);

  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

// Run setup
createTestAttendanceData().then(() => {
  console.log('\n✅ Test attendance data created! Check the scan page now.');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Setup failed:', error);
  process.exit(1);
});
