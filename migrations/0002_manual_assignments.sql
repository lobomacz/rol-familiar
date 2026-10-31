ALTER TABLE roles ADD COLUMN manually_assigned INTEGER NOT NULL DEFAULT 0 CHECK(manually_assigned IN (0, 1));
