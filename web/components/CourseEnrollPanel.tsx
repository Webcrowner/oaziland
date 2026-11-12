"use client";
import type { TrainingProgram } from "@/lib/api";
import TrainingEnrollActions, { useMyEnrollments } from "@/components/TrainingEnrollActions";

/** The enroll / pay / open buttons for the one course on its own page. */
export default function CourseEnrollPanel({ program }: { program: TrainingProgram }) {
  const { enrollments, loggedIn, reload } = useMyEnrollments();
  return <TrainingEnrollActions program={program} enrollment={enrollments.get(program.id)} loggedIn={loggedIn} reload={reload} />;
}
