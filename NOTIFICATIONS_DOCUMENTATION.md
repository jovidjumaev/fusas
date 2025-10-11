# Student Notifications System

This document describes the comprehensive notification system implemented for students in the FSAS (Faculty Student Attendance System).

## Overview

The notification system provides real-time notifications to students for three key events:
1. **Class Enrollment** - When a professor adds them to a class
2. **Session Start** - When a professor starts a class session
3. **Attendance Recording** - When their attendance is successfully recorded

## Notification Types

### 1. Class Enrollment (`class_enrolled`)
- **Trigger**: When a professor enrolls a student in a class (single or bulk enrollment)
- **Priority**: High
- **Icon**: 🎓
- **Message**: "You've been enrolled in [ClassName] by Professor [ProfessorName]. Check your dashboard to view class details."
- **Link**: `/student/classes/[classInstanceId]`

### 2. Session Started (`session_started`)
- **Trigger**: When a professor activates/starts a class session
- **Priority**: Urgent
- **Icon**: 🚀
- **Message**: "[ClassName] session has started at [Time] in [Room]. You can now scan the QR code to mark your attendance."
- **Link**: `/student/scan`

### 3. Attendance Recorded (`attendance_recorded`)
- **Trigger**: When a student successfully scans QR code and attendance is recorded
- **Priority**: Medium
- **Icon**: ✅
- **Message**: "Your attendance has been recorded for [ClassName]. Status: [present/late]."
- **Link**: `/student/attendance`

## Implementation Details

### Frontend Components

#### Notification Service (`src/lib/notifications.ts`)
Enhanced with student-specific methods:
- `notifyStudentEnrolled()` - Creates enrollment notifications
- `notifySessionStarted()` - Creates session start notifications
- `notifyAttendanceRecorded()` - Creates attendance confirmation notifications
- `bulkNotifySessionStarted()` - Bulk creates session notifications for multiple students

#### Notification Panel (`src/components/notifications/notification-panel.tsx`)
- Real-time notification updates via Supabase subscriptions
- Browser notification support
- Mark as read/unread functionality
- Notification filtering (all/unread)
- Direct links to relevant pages

### Backend Integration

#### Class Management API (`backend/final-class-management-api.js`)
- **Single Enrollment**: `/api/class-instances/:classInstanceId/enroll`
- **Bulk Enrollment**: `/api/class-instances/:classInstanceId/bulk-enroll`
- Both endpoints now create notifications for enrolled students

#### Session Management API (`backend/session-management-api.js`)
- **Session Activation**: `/api/sessions/:sessionId/activate`
- Enhanced `notifyStudentsSessionActivated()` function creates notifications for all enrolled students

#### Attendance API (`backend/attendance-api.js`)
- **QR Code Scan**: `/api/attendance/scan`
- Creates attendance confirmation notification after successful scan

### Database Schema

#### Notifications Table
```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN (
        'attendance_reminder', 'attendance_marked', 'class_cancelled', 
        'class_rescheduled', 'grade_posted', 'assignment_due', 
        'announcement', 'system', 'class_enrolled', 'session_started', 
        'attendance_recorded'
    )),
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    link VARCHAR(500),
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMP WITH TIME ZONE,
    class_id UUID REFERENCES class_instances(id) ON DELETE CASCADE,
    session_id UUID REFERENCES class_sessions(id) ON DELETE CASCADE,
    metadata JSONB DEFAULT '{}',
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Usage Examples

### Creating Notifications Programmatically

```typescript
import { NotificationService } from '@/lib/notifications';

// Notify student of enrollment
await NotificationService.notifyStudentEnrolled(
  studentId,
  classInstanceId,
  'CSC-105 - Introduction to Computer Science',
  'Professor John Smith'
);

// Notify student of session start
await NotificationService.notifySessionStarted(
  studentId,
  sessionId,
  'CSC-105 - Introduction to Computer Science',
  '2024-01-15 at 10:00:00',
  'Room 101'
);

// Notify student of attendance recording
await NotificationService.notifyAttendanceRecorded(
  studentId,
  sessionId,
  'CSC-105 - Introduction to Computer Science',
  'present',
  0
);
```

### Bulk Notifications

```typescript
// Notify multiple students when session starts
await NotificationService.bulkNotifySessionStarted(
  studentIds,
  sessionId,
  'CSC-105 - Introduction to Computer Science',
  '2024-01-15 at 10:00:00',
  'Room 101'
);
```

## Real-time Features

### Supabase Subscriptions
The notification panel subscribes to real-time updates:
```typescript
const subscription = supabase
  .channel(`notifications:${userId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'notifications',
    filter: `user_id=eq.${userId}`
  }, (payload) => {
    // Handle new notification
    onNotification(payload.new as Notification);
  })
  .subscribe();
```

### Browser Notifications
- Automatic browser notification permission request
- Desktop notifications for urgent notifications
- Fallback to in-app notifications

## Testing

### Test Script
Run the test script to verify notification functionality:
```bash
node test-notifications.js
```

### Manual Testing Steps
1. **Enrollment Test**: Add a student to a class and verify notification appears
2. **Session Test**: Start a class session and verify all enrolled students receive notifications
3. **Attendance Test**: Scan QR code and verify attendance confirmation notification

## Configuration

### Environment Variables
Ensure these are set in your environment:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for admin operations)

### Notification Settings
- **Priority Levels**: low, medium, high, urgent
- **Expiration**: Notifications can have expiration dates
- **Metadata**: Additional data stored in JSONB format

## Future Enhancements

### Planned Features
1. **Email Notifications**: Send email copies of important notifications
2. **SMS Notifications**: SMS alerts for urgent notifications
3. **Push Notifications**: Mobile app push notifications
4. **Notification Preferences**: User-configurable notification settings
5. **Notification Templates**: Customizable notification templates
6. **Analytics**: Notification engagement tracking

### Integration Points
- **Calendar Integration**: Add class sessions to student calendars
- **Mobile App**: Push notifications for mobile users
- **Email Service**: SMTP integration for email notifications
- **SMS Service**: Twilio integration for SMS alerts

## Troubleshooting

### Common Issues
1. **Notifications not appearing**: Check Supabase connection and user authentication
2. **Real-time updates not working**: Verify WebSocket connection and subscription setup
3. **Browser notifications blocked**: Check browser notification permissions
4. **Database errors**: Ensure notifications table exists and has proper permissions

### Debug Tools
- Browser console logs for notification events
- Supabase dashboard for database inspection
- Network tab for API call verification
- Test script for isolated testing

## Security Considerations

### Data Privacy
- Notifications contain minimal personal information
- Metadata is stored securely in JSONB format
- User data is properly anonymized in logs

### Access Control
- Row Level Security (RLS) enabled on notifications table
- Users can only access their own notifications
- Admin operations require service role key

### Rate Limiting
- Bulk notification operations are batched
- Database constraints prevent notification spam
- Error handling prevents system overload

---

This notification system enhances the student experience by providing timely, relevant information about their academic activities and ensuring they never miss important class events.
