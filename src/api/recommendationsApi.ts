const ALGOLIA_ENDPOINT =
  "https://xsr6ry5q4a-dsn.algolia.net/1/indexes/*/recommendations";

const ALGOLIA_QUERY = new URLSearchParams({
  "x-algolia-agent":
    "Algolia for JavaScript (5.25.0); Recommend (5.25.0); Browser",
  "x-algolia-api-key": "4e0c31dd5defc17bd58f352bd7d7f4cd",
  "x-algolia-application-id": "XSR6RY5Q4A",
});

const ALGOLIA_HEADERS = {
  "Content-Type": "application/json",
};

type RecommendationHit = {
  objectID: string;
  _score?: number;
};

type RecommendationResult = {
  hits: RecommendationHit[];
};

type RecommendationResponse = {
  results: RecommendationResult[];
};

export interface RecommendationOptions {
  maxRecommendations?: number;
  threshold?: number;
}

export const fetchRelatedProductIds = async (
  productId: string,
  options: RecommendationOptions = {},
  signal?: AbortSignal
) => {
  if (!productId) {
    throw new Error("Product ID is required for recommendations");
  }

  const { maxRecommendations = 12, threshold = 50 } = options;

  const payload = {
    requests: [
      {
        indexName: "products_sa",
        objectID: productId,
        model: "related-products",
        threshold,
        maxRecommendations,
        queryParameters: {
          attributesToRetrieve: ["objectID"],
          attributesToHighlight: [],
        },
      },
    ],
  };

  const response = await fetch(`${ALGOLIA_ENDPOINT}?${ALGOLIA_QUERY.toString()}`, {
    method: "POST",
    headers: ALGOLIA_HEADERS,
    signal,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `Recommendations API error (${productId}): ${response.status}`
    );
  }

  const data = (await response.json()) as RecommendationResponse;
  const hits = data.results?.[0]?.hits ?? [];

  return hits
    .map((hit) => hit.objectID)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
};


