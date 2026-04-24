const PRODUCT_BASE_URL = "https://api.abyat.com/products";

export interface ProductRequestOptions {
  locale: string;
  currency: string;
  marketplace: string;
  withInstallation?: boolean;
  forDisplay?: boolean;
}

const normalizeLocale = (locale: string) => {
  if (!locale) return "en-US";
  return locale.includes("_") ? locale.replace("_", "-") : locale;
};

export const fetchProductDetails = async (
  productId: string,
  options: ProductRequestOptions,
  signal?: AbortSignal
) => {
  if (!productId) {
    throw new Error("Product ID is required");
  }

  const params = new URLSearchParams({
    locale: normalizeLocale(options.locale),
    currency: options.currency,
    marketplace: options.marketplace,
    withInstallation: String(options.withInstallation ?? true),
    forDisplay: String(options.forDisplay ?? true),
  });

  const response = await fetch(`${PRODUCT_BASE_URL}/${productId}?${params.toString()}`, {
    method: "GET",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Product API error (${productId}): ${response.status}`);
  }

  return response.json();
};


