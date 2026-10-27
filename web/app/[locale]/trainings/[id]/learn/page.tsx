import CoursePlayer from "@/components/CoursePlayer";

export default async function CourseLearnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <CoursePlayer programId={id} />
    </main>
  );
}
