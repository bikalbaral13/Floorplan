const API_URL = import.meta.env.VITE_API_URL;
export const getAuthHeaders = () => {
  const token = localStorage.getItem("token") || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3ZGE1N2JkZmE2OThhNWFhMzFiMWZkZCIsInVzZXJUeXBlIjoiY3VzdG9tZXIiLCJpYXQiOjE3NzMyOTAxNzMsImV4cCI6MTc3NTg4MjE3M30._4jAm_0FAtGqHEnTFVCstvvHS1hiHtbRlTS2ONbNCFM";
  const role = localStorage.getItem("role") || "customer";

  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "x-user-type": "customer",
  };
};

const handleUnauthorized = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("role");

  // Avoid redirect loop
  if (window.location.pathname !== "/signin") {
    window.location.href = "/signin";
  }
};

export const postServiceByEntity = async (
  entityId: string,
  formData: any
) => {
  const isFormData = formData instanceof FormData;
  console.log("postServiceByEntity", entityId, formData);

  const response = await fetch(
    `${API_URL}/api/user/service/${entityId}`,
    {
      method: "POST",
      body: isFormData ? formData : JSON.stringify(formData),
      headers: {
        ...getAuthHeaders(),
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
      },
    }
  );

  if (response.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }

  return await response.json();
};


export const getDataSpecificById = async (entityId: string, dataId: string) => {
  try {
console.log("getDataSpecificById", entityId, dataId);
    const response = await fetch(`${API_URL}/api/user/service/field/${entityId}/${dataId}`, {
      method: 'GET',
      headers: getAuthHeaders(),

    });
     if (response.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }

    const result = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: result?.message || 'Failed to fetch service data',
        logout: response.status === 401,
      };
    }

    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    console.error('getDataEntityById error:', error);
    return {
      success: false,
      message: error.message || 'Unknown server error',
    };
  }
};

export const getServiceByEntity = async (
  entityId: string,
    filters?: Record<string, unknown> & { field?: string; value?: unknown }
) => {
  const queryParams = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryParams.append(key, String(value));
      }
    });
  }
  const query = queryParams.toString();

  const response = await fetch(
    `${API_URL}/api/user/service/${entityId}?${query}`,
    {
      method: "GET",
      headers: getAuthHeaders(),
    }
  );
   if (response.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }
  return await response.json();
};

export const updateServiceByEntity = async (
  entityId: string,
  editingId: string,
  formData: any
) => {
  const isFormData = formData instanceof FormData;
  console.log("updateServiceByEntity", entityId, editingId, formData);

  const response = await fetch(
    `${API_URL}/api/user/service/${entityId}/${editingId}`,
    {
      method: "PUT",
      body: isFormData ? formData : JSON.stringify(formData),
      headers: {
        ...getAuthHeaders(),
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
      },
    }
  );
   if (response.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }
  return await response.json();
};

export const deleteServiceByEntity = async (entityId: string, deletingId: string) => {
  const response = await fetch(
    `${API_URL}/api/user/service/${entityId}/${deletingId}`,
    {
      method: "DELETE",
      headers: getAuthHeaders(),
    }
  );
  return await response.json();
};



const inferMimeTypeFromFilename = (filename: string): string => {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ifc":
      return "application/x-step";
    case "glb":
      return "model/gltf-binary";
    case "gltf":
      return "model/gltf+json";
    case "obj":
      return "model/obj";
    case "fbx":
      return "application/octet-stream";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
};

const resolveUploadFileMeta = (input: File | Blob): { filename: string; mimeType: string } => {
  const fileLike = input as File;
  const filename = fileLike.name && fileLike.name.trim().length > 0 ? fileLike.name : "upload.bin";
  const explicitType = (input.type || "").trim().toLowerCase();
  const inferred = inferMimeTypeFromFilename(filename);
  const mimeType = explicitType || inferred;
  return { filename, mimeType };
};

export const uploadImageToS3 = async (file: File | Blob): Promise<string | null> => {
  try {
    const formData = new FormData();
    const { filename, mimeType } = resolveUploadFileMeta(file);
    formData.append("file", file, filename);
    formData.append("userid","681c42efbad3787228013937")
    formData.append("mimetype", mimeType)
    formData.append("filename", filename)

    console.log("file.type", file.type, "resolvedMime", mimeType, "filename", filename)
    // api / file / upload
    const response = await fetch(`${API_URL}/api/r2/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) throw new Error("File upload failed");

    const data = await response.json();
    // Assuming response.files is an array of uploaded file info
    return data.file[0].url || null;
  } catch (err) {
    console.error("❌ Upload failed:", err);
    return null;
  }
};

// Agent API functions for card generation
export interface AgentResponse {
  message?: string;
  workflowlog?: {
    name?: string;
    tasks?: Array<{
      result?: {
        status?: string;
        data?: unknown;
      };
    }>;
  };
  cardData?: unknown; // The actual card data structure
}

// Agent IDs for different card types
const AGENT_IDS = {
  moodboard: "691d60462222bd196b5ecfe0", // Step 1
  roomLayout: "691d9a9a2222bd196b5f06fd", // Step 2
  furnitureBundle: "69204a9948fe8962dff5af2a", // Step 3
  boq: "691d95ba2222bd196b5efd25", // Step 4
  roomGeneration: "692572a92d322a9685a4ab5f", // Step 5
};

export const generateMoodboardCard = async (
  params: { userId: string; query: string; previousCardData?: unknown }
): Promise<AgentResponse> => {
  const { userId, query, previousCardData } = params;
  const headers = getAuthHeaders();

  // First call: only pass query. Subsequent calls would pass previousCardData, but moodboard is always first
  const body = previousCardData 
    ? { userId, query, previousCardData }
    : { userId, query };

  const res = await fetch(`${API_URL}/api/user/agent/start/${AGENT_IDS.moodboard}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
   if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }
  console.log("moodboard response", res);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Moodboard agent call failed: ${res.status} ${res.statusText} - ${text}`);
  }

  return res.json();
};

export const generateRoomLayoutCard = async (
  params: { userId: string; query: string; previousCardData?: unknown }
): Promise<AgentResponse> => {
  const { userId, query, previousCardData } = params;
  const headers = getAuthHeaders();

  // Room layout always receives previous card data (moodboard)
  const body = previousCardData 
    ? { userId, query:JSON.stringify(previousCardData) }
    : { userId, query };

  const res = await fetch(`${API_URL}/api/user/agent/start/${AGENT_IDS.roomLayout}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Room layout agent call failed: ${res.status} ${res.statusText} - ${text}`);
  }

  return res.json();
};

export const generateFurnitureBundleCard = async (
  params: { userId: string; query: string; previousCardData?: unknown }
): Promise<AgentResponse> => {
  const { userId, query, previousCardData } = params;
  const headers = getAuthHeaders();

  // Furniture bundle can be first (complete-furniture flow) or receive previous card data (room-layout)
  const body = previousCardData 
    ? { userId, query:JSON.stringify(previousCardData) }
    : { userId, query };

  const res = await fetch(`${API_URL}/api/user/agent/start/${AGENT_IDS.furnitureBundle}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }
  

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Furniture bundle agent call failed: ${res.status} ${res.statusText} - ${text}`);
  }

  return res.json();
};

export const generateBOQCard = async (
  params: { userId: string; query: string; previousCardData?: unknown }
): Promise<AgentResponse> => {
  const { userId, query, previousCardData } = params;
  const headers = getAuthHeaders();

  // BOQ always receives previous card data (furniture-bundle)
  const body = previousCardData 
    ? { userId, query:JSON.stringify(previousCardData) }
    : { userId, query };

  const res = await fetch(`${API_URL}/api/user/agent/start/${AGENT_IDS.boq}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BOQ agent call failed: ${res.status} ${res.statusText} - ${text}`);
  }

  return res.json();
};

export const getAgentById = async (agentId: string): Promise<{
  success: boolean;
  data?: any;
  message?: string;
}> => {
  try {
    const headers = getAuthHeaders();
    const res = await fetch(`${API_URL}/api/user/agentlog/${agentId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Get agent failed: ${res.status} ${res.statusText} - ${errorText}`);
    }

    const data = await res.json();
    return {
      success: true,
      data,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("❌ Get agent error:", errorMessage);
    return {
      success: false,
      message: errorMessage,
    };
  }
};


export const generateFurnitureBundleCardByInspiration = async (
  params: { userId: string; query: any; }
): Promise<any> => {
  const { userId, query } = params;
  const headers = getAuthHeaders();

  const body = { userId, query:JSON.stringify(query) };

  const res = await fetch(`${API_URL}/api/user/agent/start/69219f6e48fe8962dff62722`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }
  return res.json();
};

export  const generateFurnitureBundleCardBySelectedImages = async(
    params: { userId: string; files: string[]; query: string; }
): Promise<any> => {
  const { userId, files, query } = params;
  const headers = getAuthHeaders();
  const body = { userId, files: files, query };
  const res = await fetch(`${API_URL}/api/user/agent/start/6911d8fe2222bd196b5cee73`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }
  const result = await res.json();
  const url = result.workflowlog.tasks[0].result.data[0];
  console.log("url", url);
  return url;
};  


export const generateRoomGenerationCard = async (
  params: { userId: string; query: string; files?: string; }
): Promise<any> => {
  const { userId, query, files } = params;
  const headers = getAuthHeaders();
  const body = { userId, query, files };
  const res = await fetch(`${API_URL}/api/user/agent/start/${AGENT_IDS.roomGeneration}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },  
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }
  const result = await res.json();
  const url = result.workflowlog.tasks[0].result.data.s3_url;
  console.log("url", url);
  return result;
};

export const generateFloorplanRoomGenerationCard = async (
  params: { userId: string; query: string; }
): Promise<any> => {
  const { userId, query } = params;
  const headers = getAuthHeaders();
  const body = { userId, query };
  const res = await fetch(`${API_URL}/api/user/agent/start/692d4e0d48fe8962dff7819e`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },  
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }
  const result = await res.json();
  const data = result.workflowlog.tasks[0].result.data;

  return data;

};


export const generateAgent = async (
  params: { userId: string; query: any;id: string; }
): Promise<any> => {
  const { userId, query,id } = params;
    console.log("query:",query)

  const headers = getAuthHeaders();
  const body = { userId, query };
  const res = await fetch(`${API_URL}/api/user/agent/start/${id}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    }, 
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }
  const result = await res.json();
  const data = result.workflowlog.tasks[result.workflowlog.tasks.length - 1].result.data[0];

  return data;

};

export const schemaGetServiceByEntity = async (entityId: string) => {
  const response = await fetch(`${API_URL}/api/v2/data/${entityId}`, {
    method: "GET",  
    headers: getAuthHeaders(),
  });
  console.log("schema response", response);
  return await response.json();
};

export const fetchBlobFromProxy = async (url: string) => {
  try {
    const headers = getAuthHeaders();

    const response = await fetch(
      `${API_URL}/api/user/agent/start/694e19d307e8c30156bff227`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ url: url }),
      }
    );

    const result = await response.json();
    const dataUrl = result.workflowlog.tasks[0].result.data;

    console.log("✅ Received data URL from proxy");
    return dataUrl; // This is now a proper "data:image/png;base64,..." string

  } catch (err) {
    console.error("❌ Proxy fetch failed:", err);
    return null;
  }
};