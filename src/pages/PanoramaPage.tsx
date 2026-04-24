
import React, { useState } from 'react';
import PanoramaViewer from '../components/PanoramaViewer';
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload } from 'lucide-react';

export default function PanoramaPage() {
    // Default sample equirectangular image (standard 360 test image)
    const [imageUrl, setImageUrl] = useState("https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/2294472375_24a3b8ef46_o.jpg");

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const url = URL.createObjectURL(file);
            setImageUrl(url);
        }
    };

    return (
        <div className="container mx-auto p-4 flex flex-col gap-4 h-screen">

            <Card className="flex-1 overflow-hidden min-h-[500px] border-2 border-gray-200 relative">
                <PanoramaViewer imageUrl={imageUrl} />
            </Card>

            <Card>
                <CardContent className="pt-6">
                    <div className="flex flex-col gap-4">

                        {/* Hidden File Input */}
                        <input
                            id="picture"
                            type="file"
                            accept="image/*"
                            onChange={handleFileUpload}
                            className="hidden"
                        />

                        {/* Upload Button UI */}
                        <label
                            htmlFor="picture"
                            className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl p-6 cursor-pointer hover:bg-gray-50 transition"
                        >
                            <Upload className="w-8 h-8 text-gray-500" />
                            <p className="text-sm text-gray-600 mt-2">
                                Click to upload 360° panorama image
                            </p>
                        </label>

                    </div>
                </CardContent>
            </Card>

        </div>
    );
}
