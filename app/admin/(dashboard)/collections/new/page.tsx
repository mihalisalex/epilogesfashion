import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { CollectionForm } from "@/components/admin/CollectionForm";
import { createCollection } from "@/app/admin/(dashboard)/collections/actions";
import { emptyCollectionFormValues } from "@/lib/validation/collection";
import { getAllProducts } from "@/services/products";
import { getSeoDefaults } from "@/services/seo";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function NewCollectionPage() {
  const [products, seo] = await Promise.all([getAllProducts({ includeUnpublished: true }), getSeoDefaults()]);

  return (
    <div>
      <AdminPageHeader title="New Collection" description="Add a new collection." />
      {/*
        `key` forces a fresh mount. react-hook-form reads defaultValues ONCE, on mount, and this
        page and the [id] page render <CollectionForm> at the same position in the tree — so a client-side
        navigation between them reuses the instance and keeps the previous record's values. That
        is why the form arrived pre-filled and a hard refresh cleared it.
      */}
      <CollectionForm key="new"
        defaultValues={emptyCollectionFormValues}
        products={products.map((p) => ({ id: p.id, name: p.name }))}
        seoDefaults={{ siteUrl: seo.siteUrl, titleTemplate: seo.titleTemplate }}
        onSubmit={createCollection}
        submitLabel="Create Collection"
      />
    </div>
  );
}
