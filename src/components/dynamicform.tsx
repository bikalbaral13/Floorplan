"use client";

import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ImageExpandDialog } from "./ui/image-expand-dialog";
import { uploadImageToS3 } from "@/api/action";
import { Edit } from "lucide-react";
import ImageAnnotator from "./annotation";

// ------------------------- TYPES -------------------------
type Field = BaseField;

interface BaseField {
  fieldName: string;
  id: string;
  fieldType: "string" | "object" | "array" | "file" | "select";
  required?: boolean;
  important?: boolean;
  options?: string[];
  subfields?: BaseField[];
  arraySubfields?: BaseField[];
  arrayItemType?: "string" | "object";
}

interface Schema {
  formTitle: string;
  fields: Field[];
}

interface DynamicFormProps {
  schema: Schema;
  handleSubmit?: (data: any) => void;
}

// =========================================================
export default function DynamicForm({ schema, handleSubmit }: DynamicFormProps) {
  const [formData, setFormData] = useState<any>({});
  const [previews, setPreviews] = useState<any>({});
  const [editingImage, setEditingImage] = useState<{ url: string; path: Path } | null>(null);

  // ---------------- HELPERS ----------------
  const toSafeKey = (name: string) =>
    name
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[^a-zA-Z0-9 ]/g, "")
      .split(" ")
      .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
      .join("");

  const initFieldValue = (field: Field): any => {
    const type = field.fieldType.toLowerCase();

    if (type === "string" || type === "select" || type === "file") return "";

    if (type === "object") {
      const obj: any = {};
      field.subfields?.forEach((sub) => {
        obj[toSafeKey(sub.fieldName)] = initFieldValue(sub);
      });
      return obj;
    }

    if (type === "array") {
      if (field.arrayItemType === "string") return [""];
      if (field.arrayItemType === "object" && field.arraySubfields) {
        const child: any = {};
        field.arraySubfields.forEach((sub) => {
          child[toSafeKey(sub.fieldName)] = initFieldValue(sub);
        });
        return [child];
      }
      return [];
    }

    return "";
  };



  const datta=
{
  "roomName": "Reception",
  "area": "200 sq ft",
  "planImage": "https://balconey202.s3.amazonaws.com/uploads/1765385234984_Screenshot%202025-12-10%20152431.png",
  "flooring": [
    {
      "planImage": "https://balconey202.s3.amazonaws.com/uploads/1765385236139_Screenshot%202025-12-10%20152956.png",
      "type": "Wooden flooring for waiting area",
      "size": "custom",
      "finish": "glossy",
      "color": "digital color reference",
      "pattern": "Wooden flooring ",
      "edgeDetails": "",
      "skirtingTypeHeight": "",
      "materialImages": [
        {
          "description": "Wooden flooring herringbone pattern",
          "image": "https://balconey202.s3.amazonaws.com/uploads/1765385238229_fa8fe3c083e52fa8ba443fbd292d7745.jpg"
        }
      ],
      "referenceImages": [
        {
          "description": "",
          "image": ""
        }
      ],
      "links": [
        "https://in.pinterest.com/pin/429671620713582808/"
      ]
    },
    {
      "planImage": "https://balconey202.s3.amazonaws.com/uploads/1765385236403_Screenshot%202025-12-10%20173152.png",
      "type": "Marble flooring ",
      "size": "custom",
      "finish": "glossy",
      "color": "digital color reference",
      "pattern": "",
      "edgeDetails": "",
      "skirtingTypeHeight": "",
      "materialImages": [
        {
          "description": "Marble flooring for reception area",
          "image": "https://balconey202.s3.amazonaws.com/uploads/1765385238269_1c3df07c4102de61a1e2455e8abacfcc.jpg"
        }
      ],
      "referenceImages": [
        {
          "description": "",
          "image": ""
        }
      ],
      "links": [
        "https://in.pinterest.com/pin/48906345947313517/"
      ]
    }
  ],
  "ceiling": [
    {
      "planImage": "https://balconey202.s3.amazonaws.com/uploads/1765385240554_Screenshot%202025-12-10%20152431.png",
      "type": "Wave baffle ",
      "heightFromFFL": "False ceiling bottom to 2700mm lvl",
      "coveDetails": "Wave baffle of 25mm thk and 150mm height with 50mm spacing",
      "lightFixtures": "",
      "patternOrShape": "",
      "color": "Acoustic panel colour",
      "ceilingMaterials": [
        {
          "description": "ceiling design",
          "image": "https://balconey202.s3.amazonaws.com/uploads/1765385241824_Screenshot%202025-12-10%20173047.png"
        }
      ],
      "referenceImages": [
        {
          "description": "",
          "image": ""
        }
      ],
      "links": [
        "https://arktura.com/resources/tools/"
      ]
    },
    {
      "planImage": "https://balconey202.s3.amazonaws.com/uploads/1765385240589_Screenshot%202025-12-10%20173152.png",
      "type": "Open ceiling with white pendant lights ",
      "heightFromFFL": "",
      "coveDetails": "",
      "lightFixtures": "white pendant lights",
      "patternOrShape": "",
      "color": "",
      "ceilingMaterials": [
        {
          "description": "To be placed randomly at different locations throughout the reception",
          "image": "https://balconey202.s3.amazonaws.com/uploads/1765385241749_Screenshot%202025-12-10%20173327.png"
        }
      ],
      "referenceImages": [
        {
          "description": "Open ceiling with white pendant lights",
          "image": "https://balconey202.s3.amazonaws.com/uploads/1765385243014_Screenshot%202025-12-10%20173307.png"
        }
      ],
      "links": []
    }
  ],
  "walls": [
    {
      "wallName": "moss wall",
      "planImage": "https://balconey202.s3.amazonaws.com/uploads/1765385244308_Screenshot%202025-12-10%20173517.png",
      "material": "",
      "colorCode": "digital color reference",
      "panelSizeOrArrangement": "",
      "texture": "",
      "specialFeatures": "add logo in the moss wall",
      "anyArtworkOrSignage": "want to add logo",
      "finishMaterialImages": "",
      "referenceImages": [
        {
          "image": "https://balconey202.s3.amazonaws.com/uploads/1765385245609_Screenshot%202025-12-10%20173559.png",
          "description": "moss wall"
        }
      ]
    },
    {
      "wallName": "White Fluted panel",
      "planImage": "https://balconey202.s3.amazonaws.com/uploads/1765385244303_Screenshot%202025-12-10%20173826.png",
      "material": "Cove light",
      "colorCode": "digital color reference",
      "panelSizeOrArrangement": "",
      "texture": "",
      "specialFeatures": "",
      "anyArtworkOrSignage": "",
      "finishMaterialImages": "",
      "referenceImages": [
        {
          "image": "https://balconey202.s3.amazonaws.com/uploads/1765385245169_Screenshot%202025-12-10%20173929.png",
          "description": "White Fluted panel to be continued behind the sofa up to false ceiling level"
        }
      ]
    },
    {
      "wallName": "Brooklyn Glass partition with stile door",
      "planImage": "https://balconey202.s3.amazonaws.com/uploads/1765385244935_Screenshot%202025-12-10%20174031.png",
      "material": "Glass",
      "colorCode": "",
      "panelSizeOrArrangement": "Height to 2600mm lvl with 600 spacing of frames",
      "texture": "",
      "specialFeatures": "",
      "anyArtworkOrSignage": "",
      "finishMaterialImages": "",
      "referenceImages": [
        {
          "image": "https://balconey202.s3.amazonaws.com/uploads/1765385246405_Screenshot%202025-12-10%20174130.png",
          "description": ""
        }
      ]
    },
    {
      "wallName": "Planter box with similar plants on the rear side of the sofa",
      "planImage": "https://balconey202.s3.amazonaws.com/uploads/1765385244969_Screenshot%202025-12-10%20220539.png",
      "material": "",
      "colorCode": "",
      "panelSizeOrArrangement": "",
      "texture": "",
      "specialFeatures": "",
      "anyArtworkOrSignage": "",
      "finishMaterialImages": "",
      "referenceImages": [
        {
          "image": "https://balconey202.s3.amazonaws.com/uploads/1765385246520_Screenshot%202025-12-10%20220647.png",
          "description": ""
        }
      ]
    }
  ],
  "furniture": {
    "planImage": "https://balconey202.s3.amazonaws.com/uploads/1765385247875_Screenshot%202025-12-10%20174212.png",
    "dimensions": "",
    "laminateColor": "grey",
    "legColor": "blue",
    "chairLinks": [],
    "tableDetails": [
      {
        "material": "",
        "color": "",
        "link": "https://www.naughtone.com/products/always-lounge/"
      }
    ],
    "referenceImage": []
  }
}


 
  useEffect(() => {
    const init: any = {};
    schema.fields.forEach((field) => {
      init[toSafeKey(field.fieldName)] = initFieldValue(field);
    });
    setFormData(datta);
  }, [schema]);
  // ---------------- PATH-BASED VALUE ACCESS ----------------
  type Path = (string | number)[];

  const getValueByPath = (data: any, path: Path): any => {
    let current = data;
    for (const key of path) {
      if (current === undefined || current === null) return undefined;
      current = current[key];
    }
    return current;
  };

  const setValueByPath = (data: any, path: Path, value: any): any => {
    if (path.length === 0) return value;

    const updated = structuredClone(data);
    let current = updated;

    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      
      if (typeof path[i + 1] === "number") {
        if (!Array.isArray(current[key])) {
          current[key] = [];
        }
      } else {
        if (typeof current[key] !== "object" || current[key] === null) {
          current[key] = {};
        }
      }
      
      current = current[key];
    }

    current[path[path.length - 1]] = value;
    return updated;
  };

  // ---------------- FILE CHANGE ----------------
  const handleFileChange = (path: Path, file: File | null) => {
    if (!file) return;

    const previewKey = path.join("-");
    const previewUrl = URL.createObjectURL(file);

    setPreviews((prev: any) => ({ ...prev, [previewKey]: previewUrl }));
    setFormData((prev: any) => setValueByPath(prev, path, file));
  };

  // ---------------- GENERIC CHANGE ----------------
  const handleChange = (path: Path, value: any) => {
    setFormData((prev: any) => setValueByPath(prev, path, value));
  };

  // ---------------- ARRAY OPERATIONS ----------------
  const handleAddArrayItem = (path: Path, field: Field) => {
    setFormData((prev: any) => {
      const currentArray = getValueByPath(prev, path) || [];
      
      let newItem;
      if (field.arrayItemType === "string") {
        newItem = "";
      } else if (field.arrayItemType === "object" && field.arraySubfields) {
        newItem = {};
        field.arraySubfields.forEach((sub) => {
          newItem[toSafeKey(sub.fieldName)] = initFieldValue(sub);
        });
      } else {
        newItem = "";
      }

      const newArray = [...currentArray, newItem];
      return setValueByPath(prev, path, newArray);
    });
  };

  const handleRemoveArrayItem = (path: Path, index: number) => {
    setFormData((prev: any) => {
      const currentArray = getValueByPath(prev, path) || [];
      const newArray = currentArray.filter((_: any, i: number) => i !== index);
      return setValueByPath(prev, path, newArray);
    });
  };

  // ---------------- FILE UPLOAD PROCESSING ----------------
const processFormDataForUpload = async (data: any): Promise<any> => {
  // 1. Handle null/undefined
  if (data == null) return data;
  
  // 2. Handle primitives (string, number, boolean)
  const type = typeof data;
  if (type === "string" || type === "number" || type === "boolean") {
    return data;
  }
  
  // 3. Handle File/Blob (must check before Array, as Blob is object-like)
  if (data instanceof File || data instanceof Blob) {
    return await uploadImageToS3(data);
  }
  
  // 4. Handle Arrays
  if (Array.isArray(data)) {
    const processed = [];
    for (const item of data) {
      processed.push(await processFormDataForUpload(item));
    }
    return processed;
  }
  
  // 5. Handle plain objects only
  if (type === "object" && data.constructor === Object) {
    const processed: Record<string, any> = {};
    
    for (const key of Object.keys(data)) {
      processed[key] = await processFormDataForUpload(data[key]);
    }
    
    return processed;
  }
  
  // 6. Return anything else as-is (Date, RegExp, etc.)
  return data;
};


  // ---------------- RENDER FIELDS ----------------
  const renderFieldRecursive = (field: Field, path: Path = []): React.ReactNode => {
    const key = toSafeKey(field.fieldName);
    const currentPath = [...path, key];
    const type = field.fieldType.toLowerCase();
    const label = field.fieldName;
    const value = getValueByPath(formData, currentPath);

    // ---------- STRING ----------
    if (type === "string") {
      return (
        <div key={currentPath.join("-")} className="mb-4 w-full sm:w-1/2 px-2">
          <Label>{label}</Label>
          <Input
            className="mt-1"
            value={value || ""}
            onChange={(e) => handleChange(currentPath, e.target.value)}
          />
        </div>
      );
    }

    // ---------- SELECT ----------
    if (type === "select") {
      return (
        <div key={currentPath.join("-")} className="mb-4 w-full px-2">
          <Label>{label}</Label>
          <Select 
            value={value || ""} 
            onValueChange={(val) => handleChange(currentPath, val)}
          >
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Select option" />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((opt, idx) => (
                <SelectItem key={idx} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    // ---------- FILE ----------
    if (type === "file") {
      const previewKey = currentPath.join("-");
      // Check if value is a URL string or a File object
      const isUrl = typeof value === "string" && value.length > 0;
      const isFile = value instanceof File;
      const previewUrl = isFile ? previews[previewKey] : (isUrl ? value : null);

      return (
        <div key={previewKey} className="mb-2 w-full sm:w-1/2 px-2">
          <Label>{label}</Label>
          <div className="flex gap-4">
            <div className="flex gap-2">
              <Input
                type="file"
                className="mt-1 flex-1"
                onChange={(e) => handleFileChange(currentPath, e.target.files?.[0] || null)}
              />
            </div>
          
            {previewUrl && (
              <div className="relative group">
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="w-32 h-20 object-cover rounded-lg border"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditingImage({ url: previewUrl, path: currentPath })}
                    className="h-8"
                  >
                    <Edit className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
                  <ImageExpandDialog imageUrl={previewUrl} />
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    // ---------- OBJECT ----------
    if (type === "object" && field.subfields) {
      return (
        <Card key={currentPath.join("-")} className="mb-6 w-full">
          <CardHeader>
            <CardTitle className="text-lg">{label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap">
              {field.subfields.map((sub) => renderFieldRecursive(sub, currentPath))}
            </div>
          </CardContent>
        </Card>
      );
    }

    // ---------- ARRAY ----------
    if (type === "array") {
      const arr = value || [];
      const isStringArray = field.arrayItemType === "string";

      return (
        <Card key={currentPath.join("-")} className="mb-6 w-full">
          <CardHeader>
            <CardTitle className="text-lg">{label}</CardTitle>
          </CardHeader>
          <CardContent>
            {arr.map((item: any, idx: number) => {
              const itemPath = [...currentPath, idx];
              
              return (
                <div key={idx} className="border rounded p-1 md:p-4 mb-5 relative">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="absolute right-2 top-2 z-10"
                    onClick={() => handleRemoveArrayItem(currentPath, idx)}
                  >
                    Remove
                  </Button>

                  {isStringArray ? (
                    <div className="p-4 w-full">
                      <Label>{label} {idx + 1}</Label>
                      <Input
                        type="text"
                        value={item || ""}
                        onChange={(e) => handleChange(itemPath, e.target.value)}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-wrap p-4">
                      {field.arraySubfields?.map((sub) => 
                        renderFieldRecursive(sub, itemPath)
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <Button
              onClick={() => handleAddArrayItem(currentPath, field)}
            >
              + Add {label}
            </Button>
          </CardContent>
        </Card>
      );
    }

    return null;
  };
console.log("addad:",formData)
  // =========================================================
  return (
    <div className="p-1 md:p-6">
      <div className="flex flex-wrap">
        {schema.fields.map((f) => renderFieldRecursive(f, []))}
      </div>

      <Separator className="my-6" />

      <Button
        size="lg"
        className="flex justify-end"
        onClick={async () => {
          console.log("➡️ Uploading files...");
          const finalData = await processFormDataForUpload(formData);
          console.log("✅ Final Data After Upload:", finalData);
          handleSubmit?.(finalData);
        }}
      >
        Submit
      </Button>

      {/* Image Annotator */}
      {editingImage && (() => {
        const currentValue = getValueByPath(formData, editingImage.path);
        const currentFile = currentValue instanceof File ? currentValue : null;
        const currentSource =
          editingImage.url || (typeof currentValue === "string" ? currentValue : null);

        if (!currentSource) return null;

        return (
        <ImageAnnotator
            uploadedFile={currentFile}
            imageSource={currentSource}
            initialAnnotations={[]}
            onSave={async (_annotations, annotatedImageFile) => {
            if (annotatedImageFile) {
              handleFileChange(editingImage.path, annotatedImageFile);
            }
            setEditingImage(null);
          }}
          onClose={() => setEditingImage(null)}
            allowText={true}
            allowShapes={true}
            allowFreehand={true}
            otherannotation={true}
        />
        );
      })()}
    </div>
  );
}

