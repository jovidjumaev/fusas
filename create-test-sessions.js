const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Create Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createTestSessions() {
  console.log('🚀 Creating test class sessions for today...');

  try {
    // Get today's date
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    console.log('📅 Creating sessions for:', today);

    // Get some class instances to create sessions for
    const { data: classInstances, error: classError } = await supabase
      .from('class_instances')
      .select('id, courses(code, name), days_of_week, start_time, end_time')
      .limit(3);

    if (classError) {
      console.error('❌ Error fetching class instances:', classError);
      return;
    }

    if (!classInstances || classInstances.length === 0) {
      console.error('❌ No class instances found');
      return;
    }

    console.log('📚 Found class instances:', classInstances.length);

    // Create sessions for today
    const sessionsToCreate = [];
    
    for (const classInstance of classInstances) {
      // Check if today matches any of the class days
      const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
      
      if (classInstance.days_of_week && classInstance.days_of_week.includes(todayName)) {
        sessionsToCreate.push({
          class_instance_id: classInstance.id,
          date: today,
          start_time: classInstance.start_time,
          end_time: classInstance.end_time,
          status: 'active', // Make it active so students can scan
          session_number: 1,
          is_active: true,
          attendance_count: 0,
          total_enrolled: 0
        });
      }
    }

    if (sessionsToCreate.length === 0) {
      console.log('⚠️ No classes meet today. Creating sessions anyway for testing...');
      // Create sessions for first 2 classes regardless of day
      for (let i = 0; i < Math.min(2, classInstances.length); i++) {
        const classInstance = classInstances[i];
        sessionsToCreate.push({
          class_instance_id: classInstance.id,
          date: today,
          start_time: classInstance.start_time,
          end_time: classInstance.end_time,
          status: 'active',
          session_number: 1,
          is_active: true,
          attendance_count: 0,
          total_enrolled: 0
        });
      }
    }

    console.log('📝 Creating sessions:', sessionsToCreate.length);

    // Create the sessions
    const { data: sessions, error: sessionError } = await supabase
      .from('class_sessions')
      .insert(sessionsToCreate)
      .select(`
        id,
        class_instance_id,
        date,
        start_time,
        end_time,
        status,
        class_instances!inner(
          courses(code, name)
        )
      `);

    if (sessionError) {
      console.error('❌ Error creating sessions:', sessionError);
      return;
    }

    console.log('✅ Created sessions:', sessions.length);
    sessions.forEach(session => {
      console.log(`  • ${session.class_instances.courses.code} - ${session.class_instances.courses.name} at ${session.start_time}`);
    });

    // Now create some test attendance records
    console.log('📊 Creating test attendance records...');
    
    const testStudentId = '03cfe76e-57d1-41dc-89ee-079a69750f1e'; // From the logs
    
    const attendanceRecords = [];
    for (const session of sessions) {
      // Create 2-3 attendance records per session with different statuses
      const statuses = ['present', 'late', 'present'];
      const minutesLate = [0, 8, 0]; // One late student
      
      for (let i = 0; i < Math.min(3, statuses.length); i++) {
        attendanceRecords.push({
          session_id: session.id,
          student_id: testStudentId,
          scanned_at: new Date().toISOString(),
          status: statuses[i],
          minutes_late: minutesLate[i],
          device_fingerprint: 'test-device-' + i,
          ip_address: '127.0.0.1'
        });
      }
    }

    const { data: attendanceData, error: attendanceError } = await supabase
      .from('attendance_records')
      .insert(attendanceRecords)
      .select();

    if (attendanceError) {
      console.error('❌ Error creating attendance records:', attendanceError);
    } else {
      console.log('✅ Created attendance records:', attendanceData.length);
      
      // Update session attendance counts
      for (const session of sessions) {
        const sessionAttendanceCount = attendanceRecords.filter(ar => ar.session_id === session.id).length;
        await supabase
          .from('class_sessions')
          .update({ attendance_count: sessionAttendanceCount })
          .eq('id', session.id);
      }
      
      console.log('✅ Updated session attendance counts');
    }

    console.log('🎉 Test data creation completed!');
    console.log('\n📋 Summary:');
    console.log(`• Sessions created: ${sessions.length}`);
    console.log(`• Attendance records created: ${attendanceRecords.length}`);
    console.log(`• Test student ID: ${testStudentId}`);
    console.log(`• Date: ${today}`);

  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

// Run setup
createTestSessions().then(() => {
  console.log('\n✅ Test sessions created! You can now test the scan page.');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Setup failed:', error);
  process.exit(1);
});
