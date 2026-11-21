-- Employment OS: dedicated salaried recruitment domain (separate from service missions)
CREATE TABLE IF NOT EXISTS job_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  country_id uuid NOT NULL REFERENCES countries(id),
  created_by_profile_id uuid NOT NULL REFERENCES profiles(id),
  reference_code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL,
  department text,
  contract_type text NOT NULL,
  work_mode text NOT NULL DEFAULT 'ONSITE',
  city text NOT NULL,
  salary_min numeric(14,2),
  salary_max numeric(14,2),
  salary_currency text NOT NULL,
  salary_period text NOT NULL DEFAULT 'MONTH',
  experience_level text,
  required_skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  application_deadline timestamp,
  status text NOT NULL DEFAULT 'DRAFT',
  published_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT job_posts_salary_range_check CHECK (
    (salary_min IS NULL OR salary_min >= 0) AND
    (salary_max IS NULL OR salary_max >= 0) AND
    (salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min)
  ),
  CONSTRAINT job_posts_status_check CHECK (status IN ('DRAFT','PUBLISHED','PAUSED','CLOSED','EXPIRED')),
  CONSTRAINT job_posts_work_mode_check CHECK (work_mode IN ('ONSITE','HYBRID','REMOTE'))
);
CREATE INDEX IF NOT EXISTS job_posts_country_status_created_idx ON job_posts(country_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS job_posts_org_status_idx ON job_posts(organization_id, status);

CREATE TABLE IF NOT EXISTS candidate_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  headline text,
  summary text,
  city text,
  country_iso2 text NOT NULL,
  skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  experience_years integer NOT NULL DEFAULT 0 CHECK (experience_years >= 0),
  cv_storage_ref text,
  visibility text NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE','EMPLOYERS_WITH_APPLICATION','PUBLIC')),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_profiles_country_idx ON candidate_profiles(country_iso2);

CREATE TABLE IF NOT EXISTS job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_post_id uuid NOT NULL REFERENCES job_posts(id) ON DELETE CASCADE,
  candidate_profile_id uuid NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  cover_letter text,
  status text NOT NULL DEFAULT 'SUBMITTED',
  submitted_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT job_applications_job_candidate_unique UNIQUE(job_post_id, candidate_profile_id),
  CONSTRAINT job_applications_status_check CHECK (status IN ('SUBMITTED','REVIEWING','SHORTLISTED','INTERVIEW','OFFER','HIRED','REJECTED','WITHDRAWN'))
);
CREATE INDEX IF NOT EXISTS job_applications_job_status_idx ON job_applications(job_post_id, status);
CREATE INDEX IF NOT EXISTS job_applications_candidate_idx ON job_applications(candidate_profile_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS job_application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  actor_profile_id uuid REFERENCES profiles(id),
  from_status text,
  to_status text NOT NULL,
  note text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_application_events_application_created_idx ON job_application_events(application_id, created_at);
