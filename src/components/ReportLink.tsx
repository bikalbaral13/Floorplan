import { Link } from "react-router-dom";
import { Button } from "./ui/button";
import { FileText } from "lucide-react";

export function ReportLink() {
  return (
    <Link to="/report">
      <Button
        variant="outline"
        size="sm"
        className="rounded-full gap-2"
      >
        <FileText className="w-4 h-4" />
      </Button>
    </Link>
  );
}
