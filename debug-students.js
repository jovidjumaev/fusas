const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Create Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugStudentData() {
  console.log('🔍 Debugging student data...');

  try {
    // Check students table
    const { data: students, error: studentsError } = await supabase
      .from('students')
      .select('*')
      .limit(5);

    console.log('👨‍🎓 Students table:', students?.length || 0);
    if (students && students.length > 0) {
      students.forEach(student => {
        console.log(`  • student_id: ${student.student_id}, user_id: ${student.user_id}`);
      });
    } else {
      console.log('❌ No students found in students table');
    }

    // Check attendance records
    const { data: attendance, error: attendanceError } = await supabase
      .from('attendance_records')
      .select('student_id, status, scanned_at')
      .limit(5);

    console.log('📊 Attendance records:', attendance?.length || 0);
    if (attendance && attendance.length > 0) {
      attendance.forEach(record => {
        console.log(`  • student_id: ${record.student_id}, status: ${record.status}, scanned_at: ${record.scanned_at}`);
      });
    }

    // Check if student 5002378 exists
    const { data: specificStudent, error: specificError } = await supabase
      .from('students')
      .select('*')
      .eq('student_id', '5002378')
      .single();

    console.log('🎯 Student 5002378:', specificStudent ? 'Found' : 'Not found');
    if (specificStudent) {
      console.log('  • user_id:', specificStudent.user_id);
      
      // Check attendance records for this user_id
      const { data: userAttendance, error: userAttendanceError } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('student_id', specificStudent.user_id)
        .limit(3);

      console.log('📊 Attendance records for user_id:', userAttendance?.length || 0);
      if (userAttendance && userAttendance.length > 0) {
        userAttendance.forEach(record => {
          console.log(`  • status: ${record.status}, scanned_at: ${record.scanned_at}`);
        });
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

debugStudentData().then(() => {
  console.log('\n✅ Debug complete!');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Failed:', error);
  process.exit(1);
});
