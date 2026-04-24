import PlanRenderer from "./htmlrender";

export default function ParentComponent() {
    const data = {
        planImage: "https://balconey202.s3.amazonaws.com/file/1765527088865_Screenshot%202025-12-12%20134046.png",

        "wall 1-Green":
        "A natural green accent wall featuring a custom logo, designed with greenery-inspired finishes. Digital color references ensure accurate visual consistency.",
        "wall 2-Blue": "A sleek fluted panel wall with a cove detail, adding texture, depth, and a modern linear aesthetic.",
        "wall 3-yellow": "A transparent glass wall with a stile door design, 2600mm high with 600mm spacing between vertical frames, providing openness and clean structural definition.",
        "wall 4-red": "A wall-mounted planter feature containing coordinated greenery, enhancing the surface with an organic and calming visual element.",
        

        images: [
            { image: "https://balconey202.s3.amazonaws.com/uploads/1765385245609_Screenshot%202025-12-10%20173559.png", titlt: "wall 1-Green" },
            { image: "https://balconey202.s3.amazonaws.com/uploads/1765385245169_Screenshot%202025-12-10%20173929.png", titlt: "wall 2-Blue" },
            { image: "https://balconey202.s3.amazonaws.com/uploads/1765385246405_Screenshot%202025-12-10%20174130.png", titlt: "wall 3-yellow" },
            { image: "https://balconey202.s3.amazonaws.com/uploads/1765385246520_Screenshot%202025-12-10%20220647.png", titlt: "wall 4-red" }
        ]

    };
    

    return (
        <div className="p-6">
            <PlanRenderer data={data} />
        </div>
    );
}
