import CourseEditor from "@/components/CourseEditor";

export default async function ManageCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <CourseEditor courseId={id} />
    </main>
  );
}
