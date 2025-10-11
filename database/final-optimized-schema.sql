-- =====================================================
-- FINAL OPTIMIZED DATABASE SCHEMA FOR FSAS
-- =====================================================
-- Based on detailed requirements discussion
-- Handles class management across academic periods efficiently

-- =====================================================
-- STEP 1: ENHANCED ACADEMIC PERIODS
-- =====================================================

CREATE TABLE IF NOT EXISTS academic_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL, -- 'Fall 2025', 'Spring 2026'
    year INTEGER NOT NULL,
    semester VARCHAR(20) NOT NULL, -- 'fall', 'spring', 'summer'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure only one current period
    CONSTRAINT unique_current_period EXCLUDE (is_current WITH =) WHERE (is_current = true)
);

-- =====================================================
-- STEP 2: COURSE CATALOG
-- =====================================================

CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) NOT NULL, -- 'CSC-105', 'MAT-201'
    name VARCHAR(200) NOT NULL,
    description TEXT,
    credits INTEGER DEFAULT 3,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(code)
);

-- =====================================================
-- STEP 3: CLASS INSTANCES (ENHANCED)
-- =====================================================

CREATE TABLE IF NOT EXISTS class_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    professor_id UUID NOT NULL REFERENCES professors(user_id) ON DELETE CASCADE,
    academic_period_id UUID NOT NULL REFERENCES academic_periods(id) ON DELETE CASCADE,
    
    -- Section management
    section_number INTEGER NOT NULL, -- Auto-assigned: 1, 2, 3...
    
    -- Class code (mixed format: CSC105-ABC123)
    class_code VARCHAR(20) NOT NULL UNIQUE,
    
    -- Schedule details
    days_of_week TEXT[] NOT NULL, -- ['Monday', 'Wednesday', 'Friday']
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    first_class_date DATE NOT NULL,
    last_class_date DATE NOT NULL,
    
    -- Class details
    room_location VARCHAR(100),
    max_students INTEGER DEFAULT 30,
    current_enrollment INTEGER DEFAULT 0, -- Denormalized for performance
    
    -- Status and metadata
    is_active BOOLEAN DEFAULT true,
    enrollment_deadline DATE NOT NULL, -- 2 weeks from creation
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure unique section per course per period
    UNIQUE(course_id, academic_period_id, section_number)
);

-- =====================================================
-- STEP 4: AUTO-GENERATED CLASS SESSIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS class_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_instance_id UUID NOT NULL REFERENCES class_instances(id) ON DELETE CASCADE,
    session_number INTEGER NOT NULL, -- 1, 2, 3, etc.
    
    -- Session details
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    room_location VARCHAR(100),
    
    -- Status management
    status VARCHAR(20) DEFAULT 'scheduled', -- 'scheduled', 'cancelled', 'completed'
    notes TEXT, -- Professor can add notes for cancellations
    
    -- QR Code management
    qr_secret VARCHAR(255),
    qr_expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT false,
    
    -- Attendance tracking
    attendance_count INTEGER DEFAULT 0, -- Denormalized for performance
    total_enrolled INTEGER DEFAULT 0, -- Denormalized for performance
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure unique session numbers per class instance
    UNIQUE(class_instance_id, session_number)
);

-- =====================================================
-- STEP 5: STUDENT ENROLLMENTS
-- =====================================================

CREATE TABLE IF NOT EXISTS enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
    class_instance_id UUID NOT NULL REFERENCES class_instances(id) ON DELETE CASCADE,
    
    -- Enrollment details
    enrollment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    enrolled_by UUID NOT NULL REFERENCES professors(user_id), -- Who enrolled the student
    enrollment_method VARCHAR(20) DEFAULT 'manual', -- 'manual', 'self_enrollment'
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'dropped', 'completed'
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one enrollment per student per class instance
    UNIQUE(student_id, class_instance_id)
);

-- =====================================================
-- STEP 6: ATTENDANCE RECORDS
-- =====================================================

CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
    
    -- Attendance details
    scanned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'present', -- 'present', 'late', 'absent', 'excused'
    minutes_late INTEGER DEFAULT 0, -- Calculated from start_time + 3 minute grace
    
    -- Security and audit
    device_fingerprint VARCHAR(255),
    ip_address INET,
    qr_secret_used VARCHAR(255),
    
    -- Status change tracking
    status_changed_by UUID REFERENCES professors(user_id),
    status_changed_at TIMESTAMP WITH TIME ZONE,
    status_change_reason TEXT,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one record per student per session
    UNIQUE(session_id, student_id)
);

-- =====================================================
-- STEP 7: PERFORMANCE INDEXES
-- =====================================================

-- Academic periods indexes
CREATE INDEX IF NOT EXISTS idx_academic_periods_current ON academic_periods(is_current) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_academic_periods_active ON academic_periods(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_academic_periods_year_semester ON academic_periods(year, semester);

-- Courses indexes
CREATE INDEX IF NOT EXISTS idx_courses_code ON courses(code);
CREATE INDEX IF NOT EXISTS idx_courses_active ON courses(is_active) WHERE is_active = true;

-- Class instances indexes
CREATE INDEX IF NOT EXISTS idx_class_instances_course ON class_instances(course_id);
CREATE INDEX IF NOT EXISTS idx_class_instances_professor ON class_instances(professor_id);
CREATE INDEX IF NOT EXISTS idx_class_instances_period ON class_instances(academic_period_id);
CREATE INDEX IF NOT EXISTS idx_class_instances_section ON class_instances(course_id, academic_period_id, section_number);
CREATE INDEX IF NOT EXISTS idx_class_instances_class_code ON class_instances(class_code);
CREATE INDEX IF NOT EXISTS idx_class_instances_active ON class_instances(is_active) WHERE is_active = true;

-- Class sessions indexes
CREATE INDEX IF NOT EXISTS idx_class_sessions_instance ON class_sessions(class_instance_id);
CREATE INDEX IF NOT EXISTS idx_class_sessions_date ON class_sessions(date);
CREATE INDEX IF NOT EXISTS idx_class_sessions_status ON class_sessions(status);
CREATE INDEX IF NOT EXISTS idx_class_sessions_active ON class_sessions(is_active) WHERE is_active = true;

-- Enrollments indexes
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_class_instance ON enrollments(class_instance_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON enrollments(status);
CREATE INDEX IF NOT EXISTS idx_enrollments_deadline ON enrollments(class_instance_id, enrollment_date);

-- Attendance records indexes
CREATE INDEX IF NOT EXISTS idx_attendance_records_session ON attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_student ON attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_scanned_at ON attendance_records(scanned_at);
CREATE INDEX IF NOT EXISTS idx_attendance_records_status ON attendance_records(status);

-- =====================================================
-- STEP 8: UTILITY FUNCTIONS
-- =====================================================

-- Function to generate random class code
CREATE OR REPLACE FUNCTION generate_class_code(course_code VARCHAR(20))
RETURNS VARCHAR(20) AS $$
DECLARE
    random_part VARCHAR(6);
    full_code VARCHAR(20);
    code_exists BOOLEAN;
BEGIN
    LOOP
        -- Generate 6-character random string
        random_part := upper(substring(md5(random()::text) from 1 for 6));
        full_code := course_code || '-' || random_part;
        
        -- Check if code already exists
        SELECT EXISTS(SELECT 1 FROM class_instances WHERE class_code = full_code) INTO code_exists;
        
        -- Exit loop if code is unique
        EXIT WHEN NOT code_exists;
    END LOOP;
    
    RETURN full_code;
END;
$$ LANGUAGE plpgsql;

-- Function to get next section number
CREATE OR REPLACE FUNCTION get_next_section_number(p_course_id UUID, p_academic_period_id UUID)
RETURNS INTEGER AS $$
DECLARE
    next_section INTEGER;
BEGIN
    SELECT COALESCE(MAX(section_number), 0) + 1
    INTO next_section
    FROM class_instances
    WHERE course_id = p_course_id 
    AND academic_period_id = p_academic_period_id;
    
    RETURN next_section;
END;
$$ LANGUAGE plpgsql;

-- Function to generate class sessions
CREATE OR REPLACE FUNCTION generate_class_sessions(p_class_instance_id UUID)
RETURNS VOID AS $$
DECLARE
    class_rec RECORD;
    current_date_val DATE;
    session_number INTEGER := 1;
    day_of_week INTEGER;
    target_days INTEGER[];
    i INTEGER;
BEGIN
    -- Get class instance details
    SELECT * INTO class_rec
    FROM class_instances
    WHERE id = p_class_instance_id;
    
    -- Convert days of week to integers (1=Monday, 7=Sunday)
    target_days := ARRAY[]::INTEGER[];
    FOR i IN 1..array_length(class_rec.days_of_week, 1) LOOP
        CASE class_rec.days_of_week[i]
            WHEN 'Monday' THEN target_days := array_append(target_days, 1);
            WHEN 'Tuesday' THEN target_days := array_append(target_days, 2);
            WHEN 'Wednesday' THEN target_days := array_append(target_days, 3);
            WHEN 'Thursday' THEN target_days := array_append(target_days, 4);
            WHEN 'Friday' THEN target_days := array_append(target_days, 5);
            WHEN 'Saturday' THEN target_days := array_append(target_days, 6);
            WHEN 'Sunday' THEN target_days := array_append(target_days, 7);
        END CASE;
    END LOOP;
    
    -- Generate sessions
    current_date_val := class_rec.first_class_date;
    
    WHILE current_date_val <= class_rec.last_class_date LOOP
        day_of_week := EXTRACT(DOW FROM current_date_val);
        
        -- Check if current day is in target days (skip weekends by default)
        IF day_of_week = ANY(target_days) AND day_of_week NOT IN (0, 6) THEN
            -- Insert session
            INSERT INTO class_sessions (
                class_instance_id,
                session_number,
                date,
                start_time,
                end_time,
                room_location,
                status
            ) VALUES (
                p_class_instance_id,
                session_number,
                current_date_val,
                class_rec.start_time,
                class_rec.end_time,
                class_rec.room_location,
                'scheduled'
            );
            
            session_number := session_number + 1;
        END IF;
        
        current_date_val := current_date_val + INTERVAL '1 day';
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- STEP 9: TRIGGERS FOR DATA CONSISTENCY
-- =====================================================

-- Function to update enrollment count
CREATE OR REPLACE FUNCTION update_enrollment_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE class_instances 
        SET current_enrollment = (
            SELECT COUNT(*) 
            FROM enrollments 
            WHERE class_instance_id = NEW.class_instance_id 
            AND status = 'active'
        )
        WHERE id = NEW.class_instance_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE class_instances 
        SET current_enrollment = (
            SELECT COUNT(*) 
            FROM enrollments 
            WHERE class_instance_id = OLD.class_instance_id 
            AND status = 'active'
        )
        WHERE id = OLD.class_instance_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to update session attendance count
CREATE OR REPLACE FUNCTION update_session_attendance_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE class_sessions 
        SET attendance_count = (
            SELECT COUNT(*) 
            FROM attendance_records 
            WHERE session_id = NEW.session_id
        )
        WHERE id = NEW.session_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE class_sessions 
        SET attendance_count = (
            SELECT COUNT(*) 
            FROM attendance_records 
            WHERE session_id = OLD.session_id
        )
        WHERE id = OLD.session_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-assign section and generate class code
CREATE OR REPLACE FUNCTION auto_setup_class_instance()
RETURNS TRIGGER AS $$
DECLARE
    course_code VARCHAR(20);
    next_section INTEGER;
    class_code VARCHAR(20);
BEGIN
    -- Get course code
    SELECT code INTO course_code
    FROM courses
    WHERE id = NEW.course_id;
    
    -- Get next section number
    next_section := get_next_section_number(NEW.course_id, NEW.academic_period_id);
    
    -- Generate class code
    class_code := generate_class_code(course_code);
    
    -- Set section number and class code
    NEW.section_number := next_section;
    NEW.class_code := class_code;
    
    -- Set enrollment deadline (2 weeks from creation)
    NEW.enrollment_deadline := CURRENT_DATE + INTERVAL '14 days';
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_auto_setup_class_instance ON class_instances;
CREATE TRIGGER trigger_auto_setup_class_instance
    BEFORE INSERT ON class_instances
    FOR EACH ROW
    EXECUTE FUNCTION auto_setup_class_instance();

DROP TRIGGER IF EXISTS trigger_update_enrollment_count ON enrollments;
CREATE TRIGGER trigger_update_enrollment_count
    AFTER INSERT OR UPDATE OR DELETE ON enrollments
    FOR EACH ROW
    EXECUTE FUNCTION update_enrollment_count();

DROP TRIGGER IF EXISTS trigger_update_session_attendance_count ON attendance_records;
CREATE TRIGGER trigger_update_session_attendance_count
    AFTER INSERT OR UPDATE OR DELETE ON attendance_records
    FOR EACH ROW
    EXECUTE FUNCTION update_session_attendance_count();

-- =====================================================
-- STEP 10: ANALYTICS VIEWS
-- =====================================================

-- Class attendance summary view
CREATE MATERIALIZED VIEW IF NOT EXISTS class_attendance_summary AS
SELECT 
    ci.id as class_instance_id,
    ci.class_code,
    c.code as course_code,
    c.name as course_name,
    ci.section_number,
    ap.name as period_name,
    ci.professor_id,
    p.employee_id,
    u.first_name || ' ' || u.last_name as professor_name,
    
    -- Session counts
    COUNT(cs.id) as total_sessions,
    COUNT(CASE WHEN cs.status = 'completed' THEN 1 END) as completed_sessions,
    COUNT(CASE WHEN cs.status = 'cancelled' THEN 1 END) as cancelled_sessions,
    COUNT(CASE WHEN cs.is_active = true THEN 1 END) as active_sessions,
    
    -- Enrollment counts
    COUNT(DISTINCT e.student_id) as total_enrolled,
    COUNT(DISTINCT CASE WHEN e.status = 'active' THEN e.student_id END) as active_enrolled,
    
    -- Attendance statistics (only for non-cancelled sessions)
    COUNT(CASE WHEN cs.status != 'cancelled' THEN ar.id END) as total_attendance_records,
    COUNT(CASE WHEN cs.status != 'cancelled' AND ar.status = 'present' THEN 1 END) as present_count,
    COUNT(CASE WHEN cs.status != 'cancelled' AND ar.status = 'late' THEN 1 END) as late_count,
    COUNT(CASE WHEN cs.status != 'cancelled' AND ar.status = 'absent' THEN 1 END) as absent_count,
    COUNT(CASE WHEN cs.status != 'cancelled' AND ar.status = 'excused' THEN 1 END) as excused_count,
    
    -- Calculated percentages
    CASE 
        WHEN COUNT(CASE WHEN cs.status != 'cancelled' THEN ar.id END) > 0 THEN 
            ROUND((COUNT(CASE WHEN cs.status != 'cancelled' AND ar.status = 'present' THEN 1 END)::DECIMAL / 
                   COUNT(CASE WHEN cs.status != 'cancelled' THEN ar.id END)) * 100, 2)
        ELSE 0 
    END as attendance_rate

FROM class_instances ci
LEFT JOIN courses c ON ci.course_id = c.id
LEFT JOIN academic_periods ap ON ci.academic_period_id = ap.id
LEFT JOIN professors p ON ci.professor_id = p.user_id
LEFT JOIN users u ON p.user_id = u.id
LEFT JOIN enrollments e ON ci.id = e.class_instance_id
LEFT JOIN class_sessions cs ON ci.id = cs.class_instance_id
LEFT JOIN attendance_records ar ON cs.id = ar.session_id
WHERE ci.is_active = true
GROUP BY ci.id, ci.class_code, c.code, c.name, ci.section_number, ap.name, 
         ci.professor_id, p.employee_id, u.first_name, u.last_name;

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_class_attendance_summary_class_instance 
ON class_attendance_summary(class_instance_id);

-- =====================================================
-- STEP 11: ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE academic_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- STEP 12: NOTIFICATIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS notifications (
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

-- Create indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_class_id ON notifications(class_id);
CREATE INDEX IF NOT EXISTS idx_notifications_session_id ON notifications(session_id);

-- =====================================================
-- STEP 13: SAMPLE DATA
-- =====================================================

-- Insert sample academic periods
INSERT INTO academic_periods (name, year, semester, start_date, end_date, is_current) VALUES
('Fall 2024', 2024, 'fall', '2024-08-26', '2024-12-13', false),
('Spring 2025', 2025, 'spring', '2025-01-13', '2025-05-09', true),
('Fall 2025', 2025, 'fall', '2025-08-25', '2025-12-12', false)
ON CONFLICT DO NOTHING;

-- Insert sample courses
INSERT INTO courses (code, name, description, credits) VALUES
('CSC-105', 'Introduction to Computer Science', 'Basic programming concepts and problem solving', 3),
('CSC-301', 'Data Structures', 'Advanced data structures and algorithms', 3),
('MAT-201', 'Calculus II', 'Advanced calculus concepts', 4),
('ENG-101', 'Composition I', 'Basic writing and communication skills', 3)
ON CONFLICT (code) DO NOTHING;
