const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Create Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createTodayAttendanceData() {
  console.log('🚀 Creating attendance data for today...');

  try {
    const today = new Date().toISOString().split('T')[0];
    const testStudentId = '03cfe76e-57d1-41dc-89ee-079a69750f1e';
    
    console.log('📅 Today:', today);
    console.log('👨‍🎓 Student ID:', testStudentId);

    // Get an existing session and update it to today
    const { data: sessions, error: sessionError } = await supabase
      .from('class_sessions')
      .select('*')
      .limit(1);

    if (sessionError || !sessions || sessions.length === 0) {
      console.error('❌ No sessions found');
      return;
    }

    const session = sessions[0];
    console.log('📝 Using session:', session.id);

    // Update the session to today's date
    const { error: updateError } = await supabase
      .from('class_sessions')
      .update({ 
        date: today,
        status: 'completed'
      })
      .eq('id', session.id);

    if (updateError) {
      console.error('❌ Error updating session:', updateError);
      return;
    }

    console.log('✅ Updated session to today\'s date');

    // Create attendance records for today
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
      },
      {
        session_id: session.id,
        student_id: testStudentId,
        scanned_at: new Date().toISOString(),
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
    console.log(`• Session updated: ${session.id}`);
    console.log(`• Attendance records created: ${attendanceData.length}`);
    console.log(`• Date: ${today}`);
    console.log(`• Present: ${stats.stats.present}`);
    console.log(`• Late: ${stats.stats.late}`);
    console.log(`• Total scans: ${stats.stats.scansToday}`);

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

createTodayAttendanceData().then(() => {
  console.log('\n✅ Done! Check the scan page now.');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Failed:', error);
  process.exit(1);
});
