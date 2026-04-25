import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { ProjectDetail } from "@/components/projects/ProjectDetail";
import { getProjectCards, getProjectDetail, getProjectNotifications } from "@/lib/services/aggregator";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function ProjectPage({ params }: Props) {
  const { slug } = await params;
  const notificationBaselineAt = new Date().toISOString();

  const [projects, detail, notifications] = await Promise.all([
    getProjectCards(),
    getProjectDetail(slug),
    getProjectNotifications(slug),
  ]);

  if (!detail) {
    notFound();
  }

  return (
    <AppShell
      projects={projects}
      activeSlug={slug}
      notifications={notifications}
      notificationBaselineAt={notificationBaselineAt}
    >
      <ProjectDetail key={detail.project.slug} data={detail} />
    </AppShell>
  );
}
