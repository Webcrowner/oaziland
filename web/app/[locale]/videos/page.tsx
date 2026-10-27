import type { Metadata } from "next";
import { Suspense } from "react";
import VideoFeed from "@/components/videos/VideoFeed";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return locale === "fr"
    ? {
        title: "Vidéos — maisons, séjours et services au Cameroun | Oaziland",
        description: "Regardez des visites vidéo de logements vérifiés, hôtels et services au Cameroun, puis passez directement à l'annonce.",
      }
    : {
        title: "Videos — homes, stays & services in Cameroon | Oaziland",
        description: "Watch video tours of verified homes, hotels and services across Cameroon, then jump straight to the listing.",
      };
}

export default function VideosPage() {
  return (
    <Suspense fallback={null}>
      <VideoFeed />
    </Suspense>
  );
}
