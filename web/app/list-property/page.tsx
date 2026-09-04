"use client";
import { useState } from "react";
import Header from "@/components/Header";
import { API_BASE_URL } from "@/lib/api";

/**
 * List a Property — Page 5 of Prompt 17. Posts directly to the
 * /api/listings/ endpoint (Prompt 16), which enforces MFA+KYC at the
 * permission layer — a landlord who hasn't completed those steps gets
 * a real 403 here, matching the platform-wide enforcement rule exactly
 * rather than a separate, looser check in the frontend.
 */
export default function ListPropertyPage() {
  const [listingType, setListingType] = useState("RENT");
  const [price, setPrice] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      setMessage({ type: "error", text: "Please sign in first." });
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/listings/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listing_type: listingType, price_xaf: price }),
      });

      if (res.status === 403) {
        setMessage({
          type: "error",
          text: "You need to complete multi-factor authentication and identity verification before listing a property — this is a platform-wide security requirement, not a bug.",
        });
      } else if (!res.ok) {
        setMessage({ type: "error", text: "Something went wrong. Please try again." });
      } else {
        setMessage({ type: "success", text: "Your listing was created as a draft — an admin will review it before it goes live." });
      }
    } catch {
      setMessage({ type: "error", text: "Could not reach the server." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <Header />
      <div className="max-w-lg mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-[#1B2A4A] mb-2">List a Property</h1>
        <p className="text-gray-600 mb-6 text-sm">
          This is a basic listing form. Full property-type-specific details (bedrooms, finish level, land title info, etc.) follow the same pattern shown here and are a natural next extension.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="text-sm font-semibold text-gray-700">Listing Type</label>
          <select value={listingType} onChange={(e) => setListingType(e.target.value)} className="border rounded px-3 py-2">
            <option value="RENT">For Rent</option>
            <option value="SALE">For Sale</option>
          </select>

          <label className="text-sm font-semibold text-gray-700">Price (XAF)</label>
          <input
            type="number" required min={0} className="border rounded px-3 py-2"
            value={price} onChange={(e) => setPrice(e.target.value)}
          />

          {message && (
            <p className={message.type === "success" ? "text-green-700 text-sm" : "text-red-600 text-sm"}>
              {message.text}
            </p>
          )}

          <button type="submit" disabled={loading} className="bg-[#C9A227] text-[#1B2A4A] font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50">
            {loading ? "Submitting..." : "Submit Listing"}
          </button>
        </form>
      </div>
    </main>
  );
}
