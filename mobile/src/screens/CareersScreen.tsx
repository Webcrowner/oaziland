import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  listJobPostings,
  applyToJob,
  getMyUserId,
  listMyJobApplicationsMobile,
  withdrawMyJobApplicationMobile,
  listMyJobPostingsMobile,
  listJobApplicantsMobile,
  updateJobApplicantStatusMobile,
  toggleJobOpenStateMobile,
  JOB_ROLE_CATEGORIES,
  type JobPosting,
  type MobileJobApplication,
} from "../lib/api";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Careers">;
type Tab = "explore" | "apps" | "posts";
const STATUS_ACTIONS = ["REVIEWED", "SHORTLISTED", "REJECTED", "HIRED"] as const;

/** Careers — localized mobile job board with search, role chips, My Applications (withdraw), and Employer Management. */
export default function CareersScreen({ route, navigation }: Props) {
  const { t, locale } = useI18n();
  const focusJobId = route.params?.jobId;

  const [tab, setTab] = useState<Tab>("explore");
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [coverMessage, setCoverMessage] = useState("");
  const [yearsExperience, setYearsExperience] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [appliedStatuses, setAppliedStatuses] = useState<Record<string, string>>({});

  // My applications & My postings
  const [myApps, setMyApps] = useState<MobileJobApplication[]>([]);
  const [myPosts, setMyPosts] = useState<JobPosting[]>([]);
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [applicantsByJob, setApplicantsByJob] = useState<Record<string, MobileJobApplication[]>>({});

  const loadExplore = useCallback(
    (q = query, role = roleFilter) => {
      setLoading(true);
      setLoadFailed(false);
      Promise.all([
        listJobPostings({ q: q.trim() || undefined, roleCategory: role || undefined }),
        SecureStore.getItemAsync("access_token").then((tok) =>
          tok ? getMyUserId().catch(() => null) : null,
        ),
      ])
        .then(([data, uid]) => {
          const ordered = focusJobId
            ? [
                ...data.results.filter((j) => j.id === focusJobId),
                ...data.results.filter((j) => j.id !== focusJobId),
              ]
            : data.results;
          setJobs(ordered);
          setMyUserId(uid);
        })
        .catch(() => {
          setJobs([]);
          setLoadFailed(true);
        })
        .finally(() => setLoading(false));
    },
    [focusJobId, query, roleFilter],
  );

  const loadMine = useCallback((target: "apps" | "posts") => {
    setLoading(true);
    setLoadFailed(false);
    const task =
      target === "apps"
        ? listMyJobApplicationsMobile().then(setMyApps)
        : listMyJobPostingsMobile().then(setMyPosts);
    task.catch(() => setLoadFailed(true)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadExplore("", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusJobId]);

  function switchTab(next: Tab) {
    setTab(next);
    if (next === "explore") loadExplore(query, roleFilter);
    else loadMine(next);
  }

  async function handleApply(id: string) {
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) {
      setApplyError(t("careers.signInToApply"));
      navigation.navigate("Login");
      return;
    }
    setSubmitting(true);
    setApplyError("");
    try {
      const parsedExp = yearsExperience.trim() !== "" ? Number.parseInt(yearsExperience, 10) : null;
      await applyToJob(
        id,
        coverMessage.trim(),
        parsedExp !== null && !Number.isNaN(parsedExp) ? parsedExp : null,
      );
      setAppliedStatuses((prev) => ({ ...prev, [id]: "SUBMITTED" }));
      setApplyingId(null);
      setCoverMessage("");
      setYearsExperience("");
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : t("careers.applyFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWithdraw(applicationId: string) {
    try {
      await withdrawMyJobApplicationMobile(applicationId);
      setMyApps((prev) => prev.filter((a) => a.id !== applicationId));
    } catch (err) {
      Alert.alert(t("common.actionFailedTitle"), err instanceof Error ? err.message : t("common.actionFailedBody"));
    }
  }

  async function toggleApplicants(jobId: string) {
    if (expandedPostId === jobId) {
      setExpandedPostId(null);
      return;
    }
    setExpandedPostId(jobId);
    try {
      const list = await listJobApplicantsMobile(jobId);
      setApplicantsByJob((prev) => ({ ...prev, [jobId]: list }));
    } catch (err) {
      Alert.alert(t("common.actionFailedTitle"), err instanceof Error ? err.message : t("common.actionFailedBody"));
    }
  }

  async function handleStatusAction(jobId: string, applicationId: string, newStatus: string) {
    try {
      await updateJobApplicantStatusMobile(jobId, applicationId, newStatus);
      const list = await listJobApplicantsMobile(jobId);
      setApplicantsByJob((prev) => ({ ...prev, [jobId]: list }));
    } catch (err) {
      Alert.alert(t("common.actionFailedTitle"), err instanceof Error ? err.message : t("common.actionFailedBody"));
    }
  }

  async function handleToggleOpen(job: JobPosting) {
    try {
      const reopen = job.is_open === false;
      const updated = await toggleJobOpenStateMobile(job.id, reopen);
      setMyPosts((prev) => prev.map((j) => (j.id === job.id ? updated : j)));
    } catch (err) {
      Alert.alert(t("common.actionFailedTitle"), err instanceof Error ? err.message : t("common.actionFailedBody"));
    }
  }

  const formatNum = (val: string) => Number(val).toLocaleString(locale);
  const salaryLabel = (item: JobPosting) => {
    if (item.salary_min_xaf && item.salary_max_xaf) {
      return t("careers.salaryRange", { min: formatNum(item.salary_min_xaf), max: formatNum(item.salary_max_xaf) });
    }
    if (item.salary_min_xaf) return t("careers.salaryFrom", { min: formatNum(item.salary_min_xaf) });
    if (item.salary_max_xaf) return t("careers.salaryUpTo", { max: formatNum(item.salary_max_xaf) });
    return null;
  };

  const roleLabel = (role: string) => {
    const key = `careers.role.${role}` as MessageKey;
    return (JOB_ROLE_CATEGORIES as readonly string[]).includes(role) ? t(key) : role;
  };

  const statusLabel = (st: string) => {
    const key = `careers.status.${st}` as MessageKey;
    return ["SUBMITTED", "REVIEWED", "SHORTLISTED", "REJECTED", "HIRED"].includes(st) ? t(key) : st;
  };

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        {myUserId && (
          <View style={styles.tabRow}>
            {(
              [
                ["explore", "careers.tabExplore"],
                ["apps", "careers.tabMyApps"],
                ["posts", "careers.tabMyPosts"],
              ] as const
            ).map(([key, labelKey]) => {
              const active = tab === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.tabBtn, active && styles.tabBtnActive]}
                  onPress={() => switchTab(key)}
                >
                  <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{t(labelKey)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {tab === "explore" && (
          <>
            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder={t("careers.searchPlaceholder")}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={() => loadExplore(query, roleFilter)}
                returnKeyType="search"
              />
              <TouchableOpacity style={styles.searchBtn} onPress={() => loadExplore(query, roleFilter)}>
                <Text style={styles.searchBtnText}>🔍</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              <TouchableOpacity
                style={[styles.chip, !roleFilter && styles.chipActive]}
                onPress={() => {
                  setRoleFilter("");
                  loadExplore(query, "");
                }}
              >
                <Text style={[styles.chipText, !roleFilter && styles.chipTextActive]}>{t("careers.allRoles")}</Text>
              </TouchableOpacity>
              {JOB_ROLE_CATEGORIES.map((role) => {
                const active = roleFilter === role;
                return (
                  <TouchableOpacity
                    key={role}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => {
                      const next = active ? "" : role;
                      setRoleFilter(next);
                      loadExplore(query, next);
                    }}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{roleLabel(role)}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </>
        )}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#0F172A" size="large" />
        </View>
      ) : loadFailed ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{t("careers.loadFailed")}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => (tab === "explore" ? loadExplore(query, roleFilter) : loadMine(tab))}
          >
            <Text style={styles.retryBtnText}>{t("common.tryAgain")}</Text>
          </TouchableOpacity>
        </View>
      ) : tab === "apps" ? (
        <FlatList
          data={myApps}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>{t("careers.noAppsYet")}</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.title}>{item.job_title}</Text>
              {item.company_name ? <Text style={styles.company}>{item.company_name}</Text> : null}
              <View style={styles.rowBetween}>
                <Text style={styles.appliedText}>{statusLabel(item.status)}</Text>
                {item.status !== "HIRED" && (
                  <TouchableOpacity onPress={() => void handleWithdraw(item.id)}>
                    <Text style={styles.withdrawText}>{t("careers.withdraw")}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        />
      ) : tab === "posts" ? (
        <FlatList
          data={myPosts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>{t("careers.noPostsYet")}</Text>}
          renderItem={({ item }) => {
            const open = item.is_open !== false;
            const applicants = applicantsByJob[item.id] ?? [];
            return (
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.title}>{item.title}</Text>
                  {!open && <Text style={styles.ownerBadge}>{t("careers.closedBadge")}</Text>}
                </View>
                <View style={[styles.rowBetween, { marginTop: 10 }]}>
                  <TouchableOpacity onPress={() => void toggleApplicants(item.id)}>
                    <Text style={styles.linkText}>
                      {t("careers.manageApplicants", { count: item.application_count ?? 0 })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => void handleToggleOpen(item)}>
                    <Text style={styles.cancelBtnText}>
                      {open ? t("careers.closeJob") : t("careers.reopenJob")}
                    </Text>
                  </TouchableOpacity>
                </View>
                {expandedPostId === item.id && (
                  <View style={styles.applicantsBox}>
                    {applicants.length === 0 ? (
                      <Text style={styles.meta}>{t("careers.noApplicantsYet")}</Text>
                    ) : (
                      applicants.map((app) => (
                        <View key={app.id} style={styles.applicantItem}>
                          <Text style={styles.company}>
                            {app.applicant_name} · {statusLabel(app.status)}
                          </Text>
                          {app.applicant_phone ? <Text style={styles.meta}>{app.applicant_phone}</Text> : null}
                          {app.cover_message ? <Text style={styles.description}>{app.cover_message}</Text> : null}
                          <View style={styles.formActions}>
                            {STATUS_ACTIONS.map((act) => (
                              <TouchableOpacity
                                key={act}
                                disabled={app.status === act}
                                style={[styles.smallActionBtn, app.status === act && styles.disabledBtn]}
                                onPress={() => void handleStatusAction(item.id, app.id, act)}
                              >
                                <Text style={styles.smallActionText}>
                                  {t(`careers.action.${act}` as MessageKey)}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      ))
                    )}
                  </View>
                )}
              </View>
            );
          }}
        />
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {query.trim() || roleFilter ? t("careers.noMatches") : t("careers.empty")}
            </Text>
          }
          renderItem={({ item }) => {
            const pay = salaryLabel(item);
            const appStatus = appliedStatuses[item.id] ?? item.my_application_status;
            const isOwnJob = Boolean(myUserId && item.posted_by && myUserId === item.posted_by);
            const employer = item.company_name?.trim() || item.posted_by_name?.trim() || "Oaziland Partner";
            const place = item.quarter_name
              ? item.city_name
                ? `${item.quarter_name}, ${item.city_name}`
                : item.quarter_name
              : "Cameroon";
            const empType = item.employment_type
              ? t(`careers.empType.${item.employment_type}` as MessageKey)
              : null;
            const workplace = item.workplace_type
              ? t(`careers.workplace.${item.workplace_type}` as MessageKey)
              : null;

            return (
              <View style={[styles.card, focusJobId === item.id && styles.cardHighlighted]}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.company}>{employer}</Text>
                <Text style={styles.meta}>
                  {place}
                  {workplace ? ` (${workplace})` : ""}
                  {empType ? ` · ${empType}` : ` · ${roleLabel(item.role_category)}`}
                </Text>
                {pay && <Text style={styles.salary}>{pay}</Text>}
                <Text style={styles.description}>{item.description}</Text>

                {isOwnJob ? (
                  <Text style={styles.ownerBadge}>{t("careers.yourPosting")}</Text>
                ) : appStatus ? (
                  <Text style={styles.appliedText}>
                    ✓ {t("careers.appliedStatus", { status: statusLabel(appStatus) })}
                  </Text>
                ) : applyingId === item.id ? (
                  <View style={styles.formBox}>
                    <TextInput
                      style={styles.expInput}
                      placeholder={t("careers.yearsExperiencePlaceholder")}
                      keyboardType="number-pad"
                      value={yearsExperience}
                      onChangeText={setYearsExperience}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder={t("careers.coverPlaceholder")}
                      value={coverMessage}
                      onChangeText={setCoverMessage}
                      multiline
                      numberOfLines={3}
                    />
                    {applyError !== "" && <Text style={styles.errorSmall}>{applyError}</Text>}
                    <View style={styles.formActions}>
                      <TouchableOpacity
                        style={[styles.submitButton, submitting && styles.disabledBtn]}
                        disabled={submitting}
                        onPress={() => void handleApply(item.id)}
                      >
                        <Text style={styles.submitButtonText}>
                          {submitting ? t("common.submitting") : t("careers.submit")}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.cancelBtn}
                        onPress={() => {
                          setApplyingId(null);
                          setApplyError("");
                        }}
                      >
                        <Text style={styles.cancelBtnText}>{t("common.cancel")}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.applyButton}
                    onPress={() => {
                      setApplyError("");
                      setApplyingId(item.id);
                    }}
                  >
                    <Text style={styles.applyButtonText}>{t("careers.apply")}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F2EE" },
  toolbar: { backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#E2E8F0", paddingTop: 10, paddingBottom: 8 },
  tabRow: { flexDirection: "row", paddingHorizontal: 14, gap: 8, marginBottom: 8 },
  tabBtn: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: "#F1F5F9" },
  tabBtnActive: { backgroundColor: "#0F172A" },
  tabBtnText: { fontSize: 12, fontWeight: "700", color: "#334155" },
  tabBtnTextActive: { color: "#FCD34D" },
  searchRow: { flexDirection: "row", paddingHorizontal: 14, gap: 8, marginBottom: 8 },
  searchInput: { flex: 1, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, fontSize: 13, color: "#0F172A" },
  searchBtn: { backgroundColor: "#0F172A", borderRadius: 999, paddingHorizontal: 14, justifyContent: "center", alignItems: "center" },
  searchBtnText: { color: "#FCD34D", fontSize: 14 },
  chipsRow: { paddingHorizontal: 14, gap: 6 },
  chip: { borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: "#FFFFFF", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  chipActive: { backgroundColor: "#065F46", borderColor: "#065F46" },
  chipText: { fontSize: 12, fontWeight: "700", color: "#334155" },
  chipTextActive: { color: "#FFFFFF" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  list: { padding: 14 },
  empty: { textAlign: "center", color: "#64748B", marginTop: 40, fontSize: 14 },
  errorText: { color: "#B91C1C", fontSize: 14, fontWeight: "600", marginBottom: 12, textAlign: "center" },
  retryBtn: { backgroundColor: "#0F172A", paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999 },
  retryBtnText: { color: "#FCD34D", fontWeight: "700", fontSize: 13 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: "#E2E8F0", padding: 16, marginBottom: 12 },
  cardHighlighted: { borderColor: "#F59E0B", borderWidth: 2 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "800", color: "#0F172A", flexShrink: 1 },
  company: { fontSize: 13, fontWeight: "700", color: "#1E293B", marginTop: 2 },
  meta: { fontSize: 12, color: "#64748B", marginTop: 2, marginBottom: 6 },
  salary: { fontSize: 13, fontWeight: "800", color: "#065F46", marginBottom: 8 },
  description: { fontSize: 13, color: "#334155", lineHeight: 19, marginBottom: 12 },
  applyButton: { backgroundColor: "#0F172A", borderRadius: 999, paddingVertical: 9, paddingHorizontal: 22, alignSelf: "flex-start" },
  applyButtonText: { color: "#FCD34D", fontWeight: "800", fontSize: 13 },
  formBox: { backgroundColor: "#F8FAFC", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#E2E8F0" },
  expInput: { borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: "#FFFFFF", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: "#FFFFFF", borderRadius: 8, padding: 10, fontSize: 13, minHeight: 68, textAlignVertical: "top", marginBottom: 8 },
  errorSmall: { color: "#DC2626", fontSize: 12, fontWeight: "600", marginBottom: 8 },
  formActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  submitButton: { backgroundColor: "#0F172A", borderRadius: 999, paddingVertical: 9, paddingHorizontal: 18 },
  disabledBtn: { opacity: 0.5 },
  submitButtonText: { color: "#FCD34D", fontWeight: "800", fontSize: 13 },
  cancelBtn: { borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: "#FFFFFF", borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  cancelBtnText: { color: "#475569", fontWeight: "700", fontSize: 12 },
  appliedText: { color: "#047857", fontWeight: "800", fontSize: 13 },
  withdrawText: { color: "#DC2626", fontWeight: "700", fontSize: 12 },
  linkText: { color: "#0F172A", fontWeight: "700", fontSize: 12, textDecorationLine: "underline" },
  ownerBadge: { color: "#475569", fontWeight: "700", fontSize: 12 },
  applicantsBox: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#E2E8F0", gap: 10 },
  applicantItem: { backgroundColor: "#F8FAFC", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#E2E8F0" },
  smallActionBtn: { borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: "#FFFFFF", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  smallActionText: { fontSize: 11, fontWeight: "700", color: "#334155" },
});
