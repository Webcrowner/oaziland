import CarListingForm from "@/components/CarListingForm";

/** Post a car for sale or rent by the day; `?edit=<id>` opens the lister's existing car in the same form. */
export default async function SellCarPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  return <CarListingForm editId={edit} />;
}
