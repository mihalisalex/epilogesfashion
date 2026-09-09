import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ProductForm } from "@/components/admin/ProductForm";
import { ProductLifecycleActions } from "@/components/admin/ProductLifecycleActions";
import { updateProduct } from "@/app/admin/(dashboard)/products/actions";
import { formatDate } from "@/lib/format";
import { productToFormValues } from "@/lib/validation/product";
import { getProductById } from "@/services/products";
import { getAllCollections } from "@/services/collections";
import { getCategoryOptions } from "@/services/categories";
import { getSeoDefaults } from "@/services/seo";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

interface AdminProductDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminProductDetailPage({ params }: AdminProductDetailPageProps) {
  const { id } = await params;
  const [product, collections, categories, seo] = await Promise.all([
    getProductById(id),
    getAllCollections(),
    getCategoryOptions(),
    getSeoDefaults(),
  ]);
  if (!product) notFound();

  const boundUpdate = updateProduct.bind(null, id);

  return (
    <div>
      <AdminPageHeader
        title={product.name}
        description={
          `SKU ${product.sku} · ${product.category} · ${product.status}` +
          (product.archivedAt ? ` since ${formatDate(product.archivedAt)}` : "")
        }
        actions={<ProductLifecycleActions id={id} name={product.name} status={product.status} />}
      />
      {/*
        Keyed by id for the reason the new-product page gives: without it, navigating from one
        record's edit form to another shows the FIRST record's values, and saving writes them
        onto the second.
      */}
      <ProductForm key={id}
        defaultValues={productToFormValues(product)}
        collections={collections.map((c) => ({ id: c.id, title: c.title }))}
        categories={categories}
        seoDefaults={{ siteUrl: seo.siteUrl, titleTemplate: seo.titleTemplate }}
        onSubmit={boundUpdate}
        submitLabel="Save Changes"
      />
    </div>
  );
}
