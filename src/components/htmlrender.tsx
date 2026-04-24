import { useRef } from "react";
import * as htmlToImage from "html-to-image";

export default function PlanRenderer({ data }) {
    const exportRef = useRef(null);

    const handleDownload = async () => {
        if (!exportRef.current) return;

        const dataUrl = await htmlToImage.toPng(exportRef.current, {
            quality: 1.0,
            cacheBust: true,
        });

        const link = document.createElement("a");
        link.download = "plan-output.png";
        link.href = dataUrl;
        link.click();
    };

    const getImageForWall = (wallKey) => {
        if (!data.images) return null;

        const normalize = (str) =>
            str.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9-]/g, "");

        const keyNormalized = normalize(wallKey);

        return data.images.find(
            (img) => img.titlt && keyNormalized.includes(normalize(img.titlt))
        );
    };

    return (
        <div className="p-4">
            <button
                onClick={handleDownload}
                className="mb-4 px-4 py-2 bg-black text-white rounded-lg"
            >
                Download as Image
            </button>

            <div
                ref={exportRef}
                className="w-full max-w-4xl mx-auto p-4 space-y-6 bg-white"
            >
                {/* Main Plan Image */}
                {data.planImage && (
                    <div>
                        <img
                            src={data.planImage}
                            className="w-full max-h-[500px] rounded-lg shadow"
                            alt="Plan"
                        />
                    </div>
                )}

                {/* Loop over walls dynamically */}
                <div className="grid grid-cols-2 gap-4">
                    {Object.entries(data)
                        .filter(([key]) => key !== "planImage" && key !== "images")
                        .map(([key, description]) => {
                            const imageObj = getImageForWall(key);

                            return (
                                <div
                                    key={key}
                                    className="flex flex-col md:flex-row items-start gap-4"
                                >
                                    {/* Description */}
                                    <div className="flex-1">
                                        <h2 className="text-xl font-bold">{key}</h2>
                                        <p className="text-gray-700">{description}</p>
                                    </div>

                                    {/* Image */}
                                    <div className="">
                                        {imageObj?.image ? (
                                            <img
                                                src={imageObj.image}
                                                alt={imageObj.titlt}
                                                className="w-48 h-40 object-cover rounded-lg shadow"
                                            />
                                        ) : (
                                            <p className="text-sm text-gray-400 italic">
                                                No image available
                                            </p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                </div>
            </div>
        </div>
    );
}
