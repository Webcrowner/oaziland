import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { getTrainer, type TrainerPage } from "@/lib/api";
import StarRating from "@/components/StarRating";
import TrainingCatalog from "@/components/TrainingCatalog";

type Params = Promise<{ locale: string; id: string }>;

async function load(id: string): Promise<TrainerPage | null> {
  try {
    return await getTrainer(id);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const trainer = await load(id);
  if (!trainer) return { title: "Trainer | Oaziland" };
  return { title: `${trainer.name} | Oaziland`, description: (trainer.headline || trainer.bio).slice(0, 160) };
}

export default async function TrainerProfilePage({ params }: { params: Params }) {
  const { id } = await params;
  const trainer = await load(id);
  if (!trainer) notFound();
  const t = await getTranslations("TrainerProfile");
  const initials = trainer.name.split(/\s+/).map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase();

  return (
    <>
      <section className="hero-gradient text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-center md:py-14">
          {trainer.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- profile photos from arbitrary storage hosts
            <img src={trainer.photo_url} alt={trainer.name} className="h-28 w-28 shrink-0 rounded-full border-4 border-white/20 object-cover" />
          ) : (
            <span className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full border-4 border-white/20 bg-amber-400 text-4xl font-black text-slate-950" aria-hidden>
              {initials}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-widest text-amber-300">{t("trainer")}</p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold md:text-4xl">{trainer.name}</h1>
            {trainer.headline && <p className="mt-2 text-slate-200">{trainer.headline}</p>}
            <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 text-sm">
              <div>
                <dt className="text-slate-400">{t("courses")}</dt>
                <dd className="text-2xl font-black">{trainer.stats.courses}</dd>
              </div>
              <div>
                <dt className="text-slate-400">{t("learners")}</dt>
                <dd className="text-2xl font-black">{trainer.stats.learners}</dd>
              </div>
              <div>
                <dt className="text-slate-400">{t("rating")}</dt>
                <dd className="flex items-center gap-2 text-2xl font-black">
                  {trainer.stats.rating_average !== null ? (
                    <>
                      {trainer.stats.rating_average.toFixed(1)}
                      <StarRating value={trainer.stats.rating_average} size="text-base" />
                      <span className="text-sm font-normal text-slate-400">({t("reviews", { count: trainer.stats.rating_count })})</span>
                    </>
                  ) : (
                    <span className="text-base font-normal text-slate-300">{t("noRatings")}</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {(trainer.bio || trainer.website) && (
          <section className="mb-10 max-w-3xl">
            <h2 className="mb-3 font-[family-name:var(--font-display)] text-2xl font-bold text-slate-900">{t("about", { name: trainer.name })}</h2>
            {trainer.bio && <p className="whitespace-pre-line leading-relaxed text-slate-700">{trainer.bio}</p>}
            {trainer.website && (
              <a href={trainer.website} target="_blank" rel="noopener noreferrer nofollow" className="mt-3 inline-block font-semibold text-[var(--navy)] underline">
                🔗 {trainer.website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </section>
        )}
        <h2 className="mb-4 font-[family-name:var(--font-display)] text-2xl font-bold text-slate-900">{t("coursesBy", { name: trainer.name })}</h2>
        <TrainingCatalog programs={trainer.courses} />
      </main>
    </>
  );
}
