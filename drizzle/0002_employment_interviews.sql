-- Employment OS: interview scheduling, candidate RSVP and structured recruiter evaluations
CREATE TABLE IF NOT EXISTS job_interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  scheduled_by_profile_id uuid NOT NULL REFERENCES profiles(id),
  starts_at timestamp NOT NULL,
  ends_at timestamp NOT NULL,
  timezone text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('VIDEO','PHONE','ONSITE')),
  location_or_url text,
  candidate_response text NOT NULL DEFAULT 'PENDING' CHECK (candidate_response IN ('PENDING','CONFIRMED','DECLINED')),
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','COMPLETED','CANCELLED')),
  candidate_message text,
  internal_notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT job_interviews_valid_period CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS job_interviews_application_start_idx ON job_interviews(application_id, starts_at);

CREATE TABLE IF NOT EXISTS job_interview_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id uuid NOT NULL REFERENCES job_interviews(id) ON DELETE CASCADE,
  reviewer_profile_id uuid NOT NULL REFERENCES profiles(id),
  score integer NOT NULL CHECK (score BETWEEN 1 AND 5),
  recommendation text NOT NULL CHECK (recommendation IN ('STRONG_YES','YES','HOLD','NO')),
  strengths text NOT NULL DEFAULT '',
  concerns text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT job_interview_evaluations_interview_reviewer_unique UNIQUE(interview_id, reviewer_profile_id)
);
CREATE INDEX IF NOT EXISTS job_interview_evaluations_interview_idx ON job_interview_evaluations(interview_id);
