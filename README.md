# FSAS - Furman Smart Attendance System

A modern attendance tracking system designed for Furman University that uses QR codes to make taking attendance quick, secure, and paperless.

## What It Does

FSAS replaces traditional paper attendance sheets with secure, rotating QR codes. Professors display a QR code during class, and students scan it with their phones to mark themselves present. The system tracks everything in real-time and provides detailed analytics.

## How It Works

**For Professors:**
- Create and manage your classes
- Start an attendance session to generate a QR code
- Display the QR code to your class
- Watch students check in as they scan in real-time
- View attendance reports and analytics for any class or student

**For Students:**
- Open the app when you arrive to class
- Scan the displayed QR code to mark yourself present
- View your attendance history across all classes
- See your attendance statistics and which classes you might be falling behind in

## Why It's Secure

Each QR code expires after 30 seconds and can only be scanned once per student, preventing students from marking attendance remotely or sharing QR codes. The system also uses device fingerprinting and optional geofencing to ensure students are physically present in the classroom.

## Built With

Next.js, TypeScript, Supabase, and Socket.io for real-time updates.

---

**Developer:** Jovid Jumaev (jumajo8@furman.edu)  
**Institution:** Furman University Computer Science Department
