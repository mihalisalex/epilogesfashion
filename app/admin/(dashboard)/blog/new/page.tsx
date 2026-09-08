import { connection } from "next/server";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BlogPostForm } from "@/components/admin/BlogPostForm";
import { createBlogPost } from "@/app/admin/(dashboard)/blog/actions";
import { emptyBlogFormValues } from "@/lib/validation/blog";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function NewBlogPostPage() {
  /**
   * PERF-002 tier 2 pre-step. `new Date()` below is unstable data, which Cache Components
   * refuses to prerender, and an `instant = false` opt-out does not suppress it.
   *
   * Made dynamic rather than cached, deliberately: the field is "today's date" prefilled for
   * a post being written now. A cached value would quietly hand the editor yesterday's date,
   * which is the sort of wrong nobody notices until a post is published under it.
   */
  await connection();

  return (
    <div>
      <AdminPageHeader title="New Post" description="Write a new journal post." />
      {/*
        `key` forces a fresh mount. react-hook-form reads defaultValues ONCE, on mount, and this
        page and the [id] page render <BlogPostForm> at the same position in the tree — so a client-side
        navigation between them reuses the instance and keeps the previous record's values. That
        is why the form arrived pre-filled and a hard refresh cleared it.
      */}
      <BlogPostForm key="new"
        defaultValues={{ ...emptyBlogFormValues, publishedAt: new Date().toISOString().slice(0, 10) }}
        onSubmit={createBlogPost}
        submitLabel="Publish Post"
      />
    </div>
  );
}
