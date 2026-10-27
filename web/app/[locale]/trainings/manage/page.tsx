import { getTranslations } from "next-intl/server";
import PageHeader from "@/components/ui/PageHeader";
import CourseManageList from "@/components/CourseManageList";

export default async function ManageCoursesPage() {
  const t = await getTranslations("CourseManage");
  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <CourseManageList />
    </main>
  );
}
