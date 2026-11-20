import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import JobApplyButton from "./JobApplyButton";
import JobPostForm from "./JobPostForm";
import JobPostingManagement from "./JobPostingManagement";
import CareersBoard from "./CareersBoard";
import { notificationHref } from "@/lib/notificationLinks";
import { renderWithIntl } from "./oazigo/test-utils";
import type { JobPosting } from "@/lib/api";

const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  Link: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/DirectChatButton", () => ({ default: () => null }));

function stubApi(routes: Record<string, { status?: number; body: unknown }>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url).replace(/^https?:\/\/[^/]+/, "")}`;
    const hit = routes[key];
    return Promise.resolve(new Response(JSON.stringify(hit?.body ?? {}), { status: hit?.status ?? (hit ? 200 : 404) }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("careers client components", () => {
  beforeEach(() => localStorage.setItem("access_token", "token"));
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows where an existing application stands instead of offering to apply again", async () => {
    stubApi({ "GET /api/my-job-applications/": { body: { count: 1, results: [{ id: "a1", job_posting: "job-1", job_title: "Driver", status: "SHORTLISTED", applied_at: "2026-11-01T10:00:00Z" }] } } });
    renderWithIntl(<JobApplyButton jobId="job-1" applyLabel="Apply" />);

    expect(await screen.findByText(/You applied · Shortlisted/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
  });

  it("shows the server's reason when an application is refused, e.g. the job has closed", async () => {
    stubApi({
      "GET /api/my-job-applications/": { body: { count: 0, results: [] } },
      "POST /api/jobs/job-2/apply/": { status: 409, body: { detail: "This job is no longer accepting applications." } },
    });
    renderWithIntl(<JobApplyButton jobId="job-2" applyLabel="Apply" />);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Application" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer accepting applications");
  });

  it("only shows the poster's tools to the poster", async () => {
    stubApi({ "GET /api/auth/me/": { body: { id: "someone-else" } } });
    renderWithIntl(<JobPostingManagement jobId="job-3" postedBy="poster-1" />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Close this job" })).not.toBeInTheDocument();
  });

  it("lets the poster close a job after confirming, and reports a failure instead of ignoring it", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    stubApi({ "POST /api/jobs/job-4/close/": { status: 500, body: {} } });
    renderWithIntl(<JobPostingManagement jobId="job-4" postedBy="poster-1" isOwner />);

    fireEvent.click(screen.getByRole("button", { name: "Close this job" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not close this job");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("closes the job and refreshes the list when it works", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClosed = vi.fn();
    stubApi({ "POST /api/jobs/job-5/close/": { body: { id: "job-5", status: "CLOSED" } } });
    renderWithIntl(<JobPostingManagement jobId="job-5" postedBy="poster-1" isOwner onClosed={onClosed} />);

    fireEvent.click(screen.getByRole("button", { name: "Close this job" }));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(onClosed).toHaveBeenCalled();
  });

  it("renders a split job board, switches the detail pane on selection, and bookmarks saved jobs", async () => {
    stubApi({ "GET /api/my-job-applications/": { body: { count: 0, results: [] } }, "GET /api/auth/me/": { body: { id: "viewer-1" } } });
    const sampleJobs: JobPosting[] = [
      {
        id: "j1",
        posted_by: "emp-1",
        posted_by_name: "Bastos Estates",
        title: "Senior Property Manager",
        role_category: "PROPERTY_MANAGER",
        description: "Lead our residential portfolio in Yaoundé.",
        quarter: "q1",
        quarter_name: "Bastos",
        salary_min_xaf: "250000",
        salary_max_xaf: "400000",
        status: "OPEN",
        is_open: true,
        posted_at: "2026-11-15T10:00:00Z",
        closes_at: "2026-11-30T23:59:59Z",
        application_count: 3,
        my_application_status: null,
      },
      {
        id: "j2",
        posted_by: "emp-2",
        posted_by_name: "Kribi Suites",
        title: "Field Driver",
        role_category: "DRIVER",
        description: "Shuttle guests and inspect coastal properties.",
        quarter: null,
        quarter_name: null,
        salary_min_xaf: "120000",
        salary_max_xaf: null,
        status: "OPEN",
        is_open: true,
        posted_at: "2026-11-16T10:00:00Z",
        closes_at: null,
        application_count: 0,
        my_application_status: null,
      },
    ];

    renderWithIntl(<CareersBoard jobs={sampleJobs} totalCount={sampleJobs.length} />);

    // First job is active in the right detail pane by default.
    expect(screen.getByText("Lead our residential portfolio in Yaoundé.")).toBeInTheDocument();

    // Selecting the second card switches the inspector pane.
    fireEvent.click(screen.getByText("Field Driver"));
    expect(await screen.findByText("Shuttle guests and inspect coastal properties.")).toBeInTheDocument();

    // Bookmarking updates the sidebar Saved jobs counter.
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    fireEvent.click(saveButtons[saveButtons.length - 1]);
    expect(await screen.findByRole("button", { name: /Saved \(1\)/ })).toBeInTheDocument();
  });

  it("submits a PDF CV and years of experience via multipart FormData and rejects non-PDF files", async () => {
    const fetchMock = stubApi({
      "GET /api/my-job-applications/": { body: { count: 0, results: [] } },
      "POST /api/jobs/job-cv/apply/": { status: 201, body: { id: "app-1", status: "SUBMITTED", has_cv: true } },
    });
    renderWithIntl(<JobApplyButton jobId="job-cv" applyLabel="Apply" />);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const fileInput = screen.getByLabelText("Resume / CV (PDF)") as HTMLInputElement;

    // Non-PDF rejected before network call
    const badFile = new File(["bad"], "resume.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    fireEvent.change(fileInput, { target: { files: [badFile] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/PDF file/);

    // Valid PDF accepted and sent as FormData
    const pdfFile = new File(["%PDF-1.4 sample"], "Candidate_CV.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [pdfFile] } });
    expect(screen.getByText("Candidate_CV.pdf")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Years of relevant experience/), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "Bilingual property manager." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Application" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Application submitted!");
    const postCall = fetchMock.mock.calls.find(([u, init]) => String(u).includes("/apply/") && init?.method === "POST");
    expect(postCall).toBeDefined();
    expect(postCall![1]?.body).toBeInstanceOf(FormData);
    const sentForm = postCall![1]!.body as FormData;
    expect(sentForm.get("years_experience")).toBe("5");
    expect((sentForm.get("cv_file") as File).name).toBe("Candidate_CV.pdf");
  });

  it("shows applicant CV download, experience, and verified Oaziland certificates to the employer", async () => {
    stubApi({
      "GET /api/jobs/job-9/applications/": {
        body: [
          {
            id: "app-9",
            job_posting: "job-9",
            job_title: "Agent",
            applicant: "u-9",
            applicant_name: "Awa Mbah",
            applicant_phone: "+237699000111",
            cover_message: "Ready to start.",
            years_experience: 4,
            has_cv: true,
            cv_filename: "Awa_CV.pdf",
            certificates: [{ code: "OAZ-CERT-99", title: "Agency Licensing Prep" }],
            status: "SUBMITTED",
            applied_at: "2026-11-17T10:00:00Z",
          },
        ],
      },
    });
    renderWithIntl(<JobPostingManagement jobId="job-9" postedBy="poster-1" isOwner />);

    fireEvent.click(screen.getByRole("button", { name: "Manage applications" }));

    expect(await screen.findByText("Awa Mbah")).toBeInTheDocument();
    expect(screen.getByText("4 yrs exp")).toBeInTheDocument();
    expect(screen.getByText("+237699000111")).toBeInTheDocument();
    expect(screen.getByText(/Certified: Agency Licensing Prep/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download CV" })).toBeInTheDocument();
  });

  it("hides Apply from the job poster, preserves saved jobs across filters, and renders off-page linked jobs", async () => {
    localStorage.setItem("access_token", "owner-tok");
    stubApi({
      "GET /api/my-job-applications/": { body: { count: 0, results: [] } },
      "GET /api/auth/me/": { body: { id: "owner-1" } },
    });
    // Pre-save a job from another role/page so we verify it remains visible under Saved jobs.
    const savedElsewhere: JobPosting = {
      id: "saved-other",
      posted_by: "emp-other",
      posted_by_name: "Douala Group",
      company_name: "Douala Group",
      title: "Saved Driver Role",
      role_category: "DRIVER",
      description: "Saved from another filter.",
      quarter: null,
      quarter_name: null,
      salary_min_xaf: "150000",
      salary_max_xaf: null,
      status: "OPEN",
      is_open: true,
      posted_at: "2026-11-12T10:00:00Z",
      closes_at: null,
      application_count: 1,
      my_application_status: null,
    };
    localStorage.setItem("oaziland_saved_jobs_v2", JSON.stringify({ "saved-other": savedElsewhere }));

    const currentJobs: JobPosting[] = [
      {
        id: "own-job",
        posted_by: "owner-1",
        posted_by_name: "Owner",
        title: "My Own Opening",
        role_category: "AGENT",
        description: "Posted by viewer.",
        quarter: null,
        quarter_name: null,
        salary_min_xaf: null,
        salary_max_xaf: null,
        status: "OPEN",
        is_open: true,
        posted_at: "2026-11-17T10:00:00Z",
        closes_at: null,
        application_count: 0,
        my_application_status: null,
      },
    ];
    const closedLinkedJob: JobPosting = {
      ...savedElsewhere,
      id: "closed-linked",
      title: "Closed Warden Role",
      status: "CLOSED",
      is_open: false,
    };

    renderWithIntl(
      <CareersBoard
        jobs={currentJobs}
        totalCount={1}
        initialSelectedId="closed-linked"
        linkedJob={closedLinkedJob}
      />,
    );

    // Off-page closed deep-link opens with "Applications closed" instead of falling back to another job.
    expect(screen.getByRole("heading", { level: 2, name: "Closed Warden Role" })).toBeInTheDocument();
    expect(screen.getByText("Applications closed")).toBeInTheDocument();

    // Selecting the owner's own job hides the Apply button once HideForOwner resolves.
    fireEvent.click(screen.getByText("My Own Opening"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument());

    // Saved jobs tab still lists the job saved under a different filter.
    fireEvent.click(await screen.findByRole("button", { name: /Saved \(1\)/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Saved Driver Role" })).toBeInTheDocument();
  });

  it("offers a direct KYC verification link when job creation returns 403 and supports editing an existing job", async () => {
    const fetchMock = stubApi({
      "GET /api/quarters/": { body: { count: 0, results: [] } },
      "POST /api/jobs/": { status: 403, body: { detail: "Please complete identity verification (KYC) before continuing." } },
      "PATCH /api/jobs/j-edit/": { status: 200, body: { id: "j-edit", title: "Edited Title" } },
    });

    const { unmount } = renderWithIntl(<JobPostForm />);
    fireEvent.click(screen.getByRole("button", { name: /Post a job/ }));
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Agent" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Sell homes." } });
    fireEvent.click(screen.getByRole("button", { name: "Publish job" }));

    const kycLink = await screen.findByRole("link", { name: /Complete identity verification \(KYC\)/ });
    expect(kycLink).toHaveAttribute("href", "/kyc");
    unmount();

    const existing: JobPosting = {
      id: "j-edit",
      posted_by: "emp-1",
      posted_by_name: "Emp",
      title: "Original Title",
      role_category: "AGENT",
      description: "Original desc",
      quarter: null,
      quarter_name: null,
      salary_min_xaf: "100000",
      salary_max_xaf: null,
      status: "OPEN",
      is_open: true,
      posted_at: "2026-11-17T10:00:00Z",
      closes_at: null,
      application_count: 0,
      my_application_status: null,
    };
    renderWithIntl(<JobPostForm existingJob={existing} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit job" }));
    expect(screen.getByLabelText("Job title")).toHaveValue("Original Title");
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Edited Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, init]) => String(u).includes("/api/jobs/j-edit/") && init?.method === "PATCH")).toBe(true),
    );
    expect(notificationHref({ kind: "job", id: "j-edit" })).toBe("/careers?job=j-edit");
  });

  it("lets the poster reopen a closed job", async () => {
    const fetchMock = stubApi({
      "POST /api/jobs/job-closed/reopen/": { body: { id: "job-closed", status: "OPEN", is_open: true } },
    });
    const onUpdated = vi.fn();
    renderWithIntl(<JobPostingManagement jobId="job-closed" postedBy="poster-1" isOpen={false} isOwner onUpdated={onUpdated} />);

    fireEvent.click(screen.getByRole("button", { name: "Reopen job" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([u, init]) => String(u).includes("/api/jobs/job-closed/reopen/") && init?.method === "POST")).toBe(true);
  });
});
