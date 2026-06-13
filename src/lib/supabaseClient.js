import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  import.meta?.env?.VITE_SUPABASE_URL ||
  "https://wqgaaessgckvwkkprkxl.supabase.co";

const SUPABASE_ANON_KEY =
  import.meta?.env?.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxZ2FhZXNzZ2Nrdndra3Bya3hsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNjYyMDksImV4cCI6MjA5Njk0MjIwOX0.u2i2eyBHoWv6Rdln13RxHjbrfF0dklfbI18i9M2virw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const BUCKETS = {
  CHAT_MEDIA: "chat-media",
  MEMORIES:   "memories",
};

export async function uploadToBucket(bucket, path, fileOrBlob, options = {}) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, fileOrBlob, {
      cacheControl: "3600",
      upsert: false,
      contentType: fileOrBlob.type || undefined,
      ...options,
    });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}