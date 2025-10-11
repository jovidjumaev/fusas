const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Create Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAndCreateData() {
  console.log('🔍 Checking existing data...');

  try {
    // Check existing sessions
    const { data: sessions, error: sessionError } = await supabase
      .from('class_sessions')
      .select('*')
      .limit(5);

    console.log('📅 Existing sessions:', sessions?.length || 0);
    if (sessions && sessions.length > 0) {
      sessions.forEach(session => {
        console.log(`  • ${session.id} - ${session.date} - ${session.status}`);
      });
    }

    // Check existing attendance records
    const { data: attendance, error: attendanceError } = await supabase
      .from('attendance_records')
      .select('*')
      .limit(5);

    console.log('📊 Existing attendance records:', attendance?.length || 0);
    if (attendance && attendance.length > 0) {
      attendance.forEach(record => {
        console.log(`  • ${record.id} - ${record.status} - ${record.scanned_at}`);
      });
    }

    // If no sessions exist, create one
    if (!sessions || sessions.length === 0) {
      console.log('📝 Creating a new session...');
      
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
      const today = new Date().toISOString().split('T')[0];

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

      console.log('✅ Created session:', newSession.id);

      // Create attendance records
      const testStudentId = '03cfe76e-57d1-41dc-89ee-079a69750f1e';
      
      const { data: attendanceData, error: attendanceError2 } = await supabase
        .from('attendance_records')
        .insert([
          {
            session_id: newSession.id,
            student_id: testStudentId,
            scanned_at: new Date().toISOString(),
            status: 'present',
            minutes_late: 0,
            device_fingerprint: 'test-device',
            ip_address: '127.0.0.1'
          },
          {
            session_id: newSession.id,
            student_id: testStudentId,
            scanned_at: new Date().toISOString(),
            status: 'late',
            minutes_late: 8,
            device_fingerprint: 'test-device-2',
            ip_address: '127.0.0.1'
          }
        ])
        .select();

      if (attendanceError2) {
        console.error('❌ Error creating attendance records:', attendanceError2);
        return;
      }

      console.log('✅ Created attendance records:', attendanceData.length);

      // Update session attendance count
      await supabase
        .from('class_sessions')
        .update({ attendance_count: attendanceData.length })
        .eq('id', newSession.id);

      console.log('✅ Updated session attendance count');
    }

    // Test the stats API
    console.log('🧪 Testing stats API...');
    const statsResponse = await fetch('http://localhost:3001/api/attendance/student/5002378/today-stats');
    const stats = await statsResponse.json();
    
    console.log('📊 Today\'s stats:', JSON.stringify(stats, null, 2));

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkAndCreateData().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Failed:', error);
  process.exit(1);
});
