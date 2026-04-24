import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const token = localStorage.getItem("token");
  const navigate = useNavigate();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!token) {
      navigate("/signin", { replace: true });
    } else {
      setIsReady(true);
    }
  }, [token, navigate]);

  if (!isReady) {
    return null;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
