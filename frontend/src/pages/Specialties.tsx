import { useNavigate } from "react-router-dom";
import { Stethoscope } from "lucide-react";
import { useSpecialties } from "../hooks/useCatalog";
import { Spinner } from "../components/ui/States";

export default function Specialties() {
  const { data, isLoading } = useSpecialties();
  const navigate = useNavigate();

  return (
    <div className="container-app py-10">
      <h1 className="mb-8 text-2xl font-extrabold text-slate-900">التخصصات الطبية</h1>
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {data?.map((s) => (
            <button
              key={s.id}
              onClick={() => navigate(`/doctors?specialtyId=${s.id}`)}
              className="card flex flex-col items-center gap-2 p-6 text-center transition hover:border-primary-300 hover:shadow-lg"
            >
              <Stethoscope className="h-7 w-7 text-primary-600" />
              <span className="font-semibold text-slate-800">{s.nameAr}</span>
              {s.description && <span className="text-xs text-slate-500">{s.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
