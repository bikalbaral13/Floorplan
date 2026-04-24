import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocation, useNavigate } from "react-router-dom";
import { getDataSpecificById } from "@/api/action";

const Tabs = ({ id }: { id?: string }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const [has2D, setHas2D] = useState(false);
    const [has3D, setHas3D] = useState(false);

    useEffect(() => {
        const checkData = async () => {
            if (!id) {
                setHas2D(false);
                setHas3D(false);
                return;
            }
            try {
                const response = await getDataSpecificById("69d0b54cad8abad1ca92d84b", id);
                if (response.success && response.data?.rooms?.[0]) {
                    const room = response.data.rooms[0];
                    setHas2D(!!room.UploadedFile);
                    setHas3D(!!room.threedModel);
                }
                
            } catch (error) {
                console.error("Error checking tab data:", error);
            }
        };
        checkData();
    }, [id]);

    const isActive = (path: string) => location.pathname.startsWith(path);

    return (
        <div className="flex bg-white rounded-full shadow-sm border p-1 gap-1">
            <Button
                variant="ghost"
                size="sm"
                disabled={!has2D}
                data-active={isActive("/3d-model")}
                className="rounded-full data-[active=true]:bg-black data-[active=true]:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => navigate("/3d-model/" + id)}
            >
                2D
            </Button>

            {/* <Button
                variant="ghost"
                size="sm"
                disabled={!has3D}
                data-active={isActive("/building-configurator")}
                className="rounded-full data-[active=true]:bg-black data-[active=true]:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => navigate("/building-configurator/" + id)}
            >
                3D
            </Button> */}

            { !isActive ("/innova-design") && (<><Button
                variant="ghost"
                size="sm"
                data-active={isActive("/innova-design")}
                className="rounded-full data-[active=true]:bg-black data-[active=true]:text-white"
                onClick={() => navigate("/innova-design/" + id)}
            >
                Render
            </Button>
            </>)}
            <Button
                variant="ghost"
                size="sm"
                data-active={isActive("/presentation")}
                className="rounded-full data-[active=true]:bg-black data-[active=true]:text-white"
                onClick={() => navigate("/presentation/" + id)}
            >
                Presentation
            </Button>
        </div>
    );
};

export default Tabs;
