import { Analysis, User, Variant } from '../types';
import { INITIAL_ANALYSES_LIST, INITIAL_ANALYSIS, SAMPLE_VARIANTS } from './sampleData';

const ANALYSES_BASE = 'mutatrack_analyses';
const VARIANTS_BASE = 'mutatrack_variants';

// Akun bawaan lama. Tidak lagi dipakai untuk login (login sekarang lewat server);
// tetap diekspor agar impor lama di komponen lain tidak error.
export const INITIAL_USER: User = {
  id: 'user-default-1',
  email: 'anda@institusi.id',
  nama: 'Peneliti Bioinformatika IPB',
  role: 'admin',
  created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
};

// ---------------------------------------------------------------------------
// Data lokal dipisah per pengguna: kunci localStorage diberi akhiran ":<id pengguna>".
// Tanpa pengguna aktif, tidak ada yang dibaca atau ditulis.
// ---------------------------------------------------------------------------
let activeUserId: string | null = null;
let currentUserCache: User | null = null;

// Cache varian di memori, dipakai bila localStorage penuh.
const variantsMemory: Record<string, Variant[]> = {};

const scopedKey = (base: string): string | null => (activeUserId ? `${base}:${activeUserId}` : null);

export const setStorageUser = (id: string | null): void => {
  if (activeUserId !== id) {
    for (const k of Object.keys(variantsMemory)) delete variantsMemory[k];
  }
  activeUserId = id;
};

// Pengguna yang sedang login, hanya di memori (tidak ada lagi sesi tersimpan tanpa token).
export const setCurrentUser = (user: User | null): void => {
  currentUserCache = user;
};

export const getCurrentUser = (): User | null => currentUserCache;

// Daftar pengguna kini disimpan di database server, bukan di browser.
export const getStoredUsers = (): User[] => [];

// Hapus data login simulasi versi lama (pengguna bawaan, sesi otomatis, cache varian global).
export const clearLegacyAuthStorage = (): void => {
  for (const k of ['mutatrack_users', 'mutatrack_current_user', 'mutatrack_variants']) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* abaikan */
    }
  }
};

// ---------------------------------------------------------------------------
// Penulisan localStorage yang aman: kuota penuh / storage diblokir tidak boleh
// membuat aplikasi crash. Mengembalikan true bila berhasil.
// ---------------------------------------------------------------------------
const safeSet = (key: string | null, value: string): boolean => {
  if (!key) return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn(`[MutaTrack] Gagal menyimpan "${key}" ke localStorage:`, err);
    return false;
  }
};

const safeGet = (key: string | null): string | null => {
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

// Selalu kembalikan SALINAN: saveAnalysis memodifikasi array hasil, sehingga mengembalikan
// konstanta INITIAL_ANALYSES_LIST langsung akan membuat analisis satu pengguna bocor ke pengguna lain.
const initialList = (): Analysis[] => [...INITIAL_ANALYSES_LIST];

export const getStoredAnalyses = (): Analysis[] => {
  const key = scopedKey(ANALYSES_BASE);
  if (!key) return initialList(); // belum login: hanya contoh bawaan, tidak ditulis
  try {
    const raw = safeGet(key);
    if (!raw) {
      safeSet(key, JSON.stringify(INITIAL_ANALYSES_LIST));
      return initialList();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      safeSet(key, JSON.stringify(INITIAL_ANALYSES_LIST));
      return initialList();
    }
    // Ensure the benchmark 'string' analysis is always available
    if (!parsed.some((a) => a.id === 'string' || a.nama === 'string')) {
      parsed.unshift(INITIAL_ANALYSES_LIST[0]);
      safeSet(key, JSON.stringify(parsed));
    }
    return parsed;
  } catch {
    return initialList();
  }
};

export const saveAnalyses = (analyses: Analysis[]): void => {
  safeSet(scopedKey(ANALYSES_BASE), JSON.stringify(analyses));
};

export const getAnalysisById = (id: string): Analysis | null => {
  const all = getStoredAnalyses();
  return all.find((a) => a.id === id) || null;
};

export const saveAnalysis = (analysis: Analysis): void => {
  const all = getStoredAnalyses();
  const idx = all.findIndex((a) => a.id === analysis.id);
  if (idx >= 0) {
    all[idx] = { ...analysis, updated_at: new Date().toISOString() };
  } else {
    all.unshift(analysis);
  }
  saveAnalyses(all);
};

export const deleteAnalysis = (id: string): void => {
  const all = getStoredAnalyses();
  saveAnalyses(all.filter((a) => a.id !== id));
  delete variantsMemory[id];
  const variants = getStoredVariants().filter((v) => v.analysis_id !== id);
  safeSet(scopedKey(VARIANTS_BASE), JSON.stringify(variants));
};

// Varian tersimpan di localStorage. Tidak ada lagi data contoh otomatis di sini.
export const getStoredVariants = (): Variant[] => {
  try {
    const raw = safeGet(scopedKey(VARIANTS_BASE));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveVariantsForAnalysis = (
  analysisId: string,
  variants: Omit<Variant, 'id' | 'analysis_id'>[]
): Variant[] => {
  // Hasil kosong disimpan apa adanya sebagai kosong (tanpa data contoh).
  const others = getStoredVariants().filter((v) => v.analysis_id !== analysisId);
  let nextId = others.reduce((max, v) => Math.max(max, v.id), 0) + 1;
  const newVariants: Variant[] = (variants || []).map((v) => ({
    ...v,
    id: nextId++,
    analysis_id: analysisId,
  }));

  variantsMemory[analysisId] = newVariants;

  // Coba simpan semuanya; bila kuota penuh, buang varian analisis lain lalu coba lagi.
  const key = scopedKey(VARIANTS_BASE);
  if (!safeSet(key, JSON.stringify([...others, ...newVariants]))) {
    if (!safeSet(key, JSON.stringify(newVariants))) {
      console.warn('[MutaTrack] Varian hanya disimpan di memori (localStorage penuh).');
    }
  }
  return newVariants;
};

export const getVariantsForAnalysis = (
  analysisId: string,
  options?: {
    impact?: string;
    tipe?: string;
    search?: string;
  }
): Variant[] => {
  let list: Variant[];

  if (analysisId === INITIAL_ANALYSIS.id) {
    // Hanya analisis contoh bawaan yang memakai data contoh (tidak ditulis ke localStorage).
    list = SAMPLE_VARIANTS.map((v, i) => ({
      ...v,
      id: i + 1,
      analysis_id: INITIAL_ANALYSIS.id,
    }));
  } else if (variantsMemory[analysisId]) {
    list = variantsMemory[analysisId];
  } else {
    list = getStoredVariants().filter((v) => v.analysis_id === analysisId);
  }

  if (options?.impact && options.impact !== 'ALL') {
    list = list.filter((v) => v.impact === options.impact);
  }
  if (options?.tipe && options.tipe !== 'ALL') {
    list = list.filter((v) => v.tipe === options.tipe);
  }
  if (options?.search) {
    const s = options.search.toLowerCase();
    list = list.filter(
      (v) =>
        (v.gen && v.gen.toLowerCase().includes(s)) ||
        (v.efek && v.efek.toLowerCase().includes(s)) ||
        v.chrom.toLowerCase().includes(s) ||
        String(v.posisi).includes(s)
    );
  }
  return [...list].sort((a, b) => a.posisi - b.posisi);
};

export const checkFastqContent = (filename: string, content?: string): string | null => {
  const cleanName = filename.toLowerCase().replace('.gz', '');
  if (!cleanName.endsWith('.fastq') && !cleanName.endsWith('.fq')) {
    return 'Ekstensi harus .fastq atau .fq (boleh .gz).';
  }
  if (!content) return null;
  const lines = content.trim().split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 4) {
    return 'Berkas FASTQ minimal memuat 4 baris rekaman sekuens.';
  }
  if (!lines[0].startsWith('@')) {
    return 'Header FASTQ harus diawali karakter "@".';
  }
  if (!lines[2].startsWith('+')) {
    return 'Baris separator FASTQ harus diawali karakter "+".';
  }
  return null;
};

export const checkFastaContent = (filename: string, content?: string): string | null => {
  const cleanName = filename.toLowerCase().replace('.gz', '');
  if (!cleanName.endsWith('.fa') && !cleanName.endsWith('.fasta') && !cleanName.endsWith('.fna') && !cleanName.endsWith('.rna')) {
    return 'Ekstensi genom referensi harus .fa, .fasta, .fna, atau .rna (boleh .gz).';
  }
  if (!content) return null;
  const lines = content.trim().split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0 || !lines[0].startsWith('>')) {
    return 'Format FASTA tidak valid (baris pertama harus diawali ">").';
  }
  return null;
};