"use client";

import { useState } from "react";

interface MovimientoStats {
  total: number;
  monto: number;
}

interface DaySummary {
  fecha: string;
  totalRegistros: number;
  montoTotal: number;
}

interface V1Response {
  success?: boolean;
  error?: string;
  logGroup?: string;
  dateRange?: { start: string; end: string };
  statistics?: {
    recordsMatched: number;
    recordsScanned: number;
    bytesScanned: number;
  };
  summary?: {
    totalPagos: number;
    montoTotal: number;
    porMovimiento?: Record<string, MovimientoStats>;
  };
  byDay?: DaySummary[];
  rawSample?: Array<Record<string, string>>;
}

export default function V1Page() {
  const [startDate, setStartDate] = useState("2026-01-01");
  const [endDate, setEndDate] = useState("2026-01-31");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<V1Response | null>(null);
  const [exploreData, setExploreData] = useState<V1Response | null>(null);
  const [showExplore, setShowExplore] = useState(false);

  const handleQuery = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    setShowExplore(false);

    try {
      const response = await fetch(
        `/api/v1/payments-by-day?startDate=${startDate}&endDate=${endDate}&_t=${Date.now()}`
      );
      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Error al consultar pagos V1");
        return;
      }

      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  const handleExplore = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    setExploreData(null);
    setShowExplore(true);

    try {
      const response = await fetch(
        `/api/explore?startDate=${startDate}&endDate=${endDate}&version=v1`
      );
      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Error al explorar logs V1");
        return;
      }

      setExploreData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
    }).format(amount);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Análisis V1 - Workflow Legacy
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                ReconciliationProcessAndConfirmationStateMachine (sin V2)
              </p>
            </div>
            <a
              href="/"
              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              ← Volver a V2
            </a>
          </div>

          {/* Indicador de versión */}
          <div className="mb-6 p-4 bg-purple-50 rounded-lg border border-purple-200">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 text-sm font-medium rounded-full bg-purple-600 text-white">
                V1
              </span>
              <span className="text-sm text-purple-700">
                Log Group: <code className="bg-purple-100 px-2 py-0.5 rounded">/aws/vendedlogs/states/ReconciliationProcessAndConfirmationStateMachineLogs/master</code>
              </span>
            </div>
          </div>

          {/* Búsqueda por rango de fechas */}
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha Inicio
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha Fin
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
            <button
              onClick={handleQuery}
              disabled={loading}
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white font-medium px-6 py-2 rounded-md transition-colors"
            >
              {loading && !showExplore ? "Consultando..." : "Pagos Exitosos V1"}
            </button>
            <button
              onClick={handleExplore}
              disabled={loading}
              className="bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white font-medium px-6 py-2 rounded-md transition-colors"
            >
              {loading && showExplore ? "Explorando..." : "Explorar Logs"}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mt-6">
              <p className="font-medium">Error:</p>
              <p>{error}</p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
              <span className="ml-3 text-gray-600">
                Consultando CloudWatch Logs V1...
              </span>
            </div>
          )}

          {/* Resultados */}
          {data && data.success && (
            <>
              {data.statistics && (
                <div className="bg-gray-50 rounded-lg p-4 mt-6 mb-6">
                  <h3 className="text-sm font-medium text-gray-500 mb-2">
                    Estadísticas de Query V1
                  </h3>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Registros encontrados:</span>
                      <span className="ml-2 font-medium text-gray-900">
                        {data.statistics.recordsMatched.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Registros escaneados:</span>
                      <span className="ml-2 font-medium text-gray-900">
                        {data.statistics.recordsScanned.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Bytes escaneados:</span>
                      <span className="ml-2 font-medium text-gray-900">
                        {(data.statistics.bytesScanned / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {data.summary && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-6 text-white">
                      <h3 className="text-sm font-medium opacity-80">Pagos Exitosos V1</h3>
                      <p className="text-4xl font-bold mt-2">
                        {data.summary.totalPagos.toLocaleString()}
                      </p>
                      <p className="text-xs opacity-70 mt-1">Trámite encontrado en DB</p>
                    </div>
                    <div className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-lg p-6 text-white">
                      <h3 className="text-sm font-medium opacity-80">Monto Total V1</h3>
                      <p className="text-4xl font-bold mt-2">
                        {formatCurrency(data.summary.montoTotal)}
                      </p>
                    </div>
                  </div>

                  {data.summary.porMovimiento && Object.keys(data.summary.porMovimiento).length > 0 && (
                    <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-lg p-6 text-white mb-8">
                      <h3 className="text-lg font-medium mb-4">Por Tipo de Trámite V1</h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                        {Object.entries(data.summary.porMovimiento).map(([tipo, stats]) => (
                          <div key={tipo} className="bg-white/10 rounded-lg p-3">
                            <p className="text-sm font-bold">{tipo}</p>
                            <p className="text-2xl font-bold">{stats.total.toLocaleString()}</p>
                            <p className="text-xs opacity-80">{formatCurrency(stats.monto)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {data.byDay && data.byDay.length > 0 && (
                <div className="overflow-x-auto">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">
                    Pagos V1 por Día ({data.byDay.length} días)
                  </h3>
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Fecha
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                          Registros
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                          Monto Total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {data.byDay.map((row) => (
                        <tr key={row.fecha} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-mono text-gray-900">
                            {row.fecha}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                            {row.totalRegistros.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                            {formatCurrency(row.montoTotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {data.byDay && data.byDay.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-lg">No se encontraron pagos exitosos V1</p>
                </div>
              )}
            </>
          )}

          {/* Exploración de logs */}
          {exploreData && showExplore && (
            <div className="mt-6">
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
                <h3 className="text-lg font-medium text-purple-800 mb-2">
                  Exploración de Logs V1
                </h3>
                <p className="text-sm text-purple-700">
                  Log Group: <code className="bg-purple-100 px-1 rounded">{exploreData.logGroup}</code>
                </p>
                <p className="text-sm text-purple-700">
                  Registros encontrados: {exploreData.statistics?.recordsMatched?.toLocaleString()}
                </p>
              </div>

              {exploreData.rawSample && exploreData.rawSample.length > 0 ? (
                <div className="space-y-4">
                  <h4 className="font-medium text-gray-900">Logs crudos V1:</h4>
                  {exploreData.rawSample.map((log, index) => (
                    <div key={index} className="bg-gray-800 rounded-lg p-4 overflow-x-auto">
                      <p className="text-xs text-gray-400 mb-2">#{index + 1} - {log["@timestamp"]}</p>
                      <pre className="text-purple-400 text-xs whitespace-pre-wrap break-all">
                        {JSON.stringify(JSON.parse(log["@message"] || "{}"), null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No se encontraron logs V1 en el período seleccionado
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer con info */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Diferencias V1 vs V2
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-purple-50 rounded-lg p-4">
              <h4 className="font-medium text-purple-800 mb-2">V1 (Legacy)</h4>
              <ul className="text-sm text-purple-700 space-y-1">
                <li>• Estructura: loteId con array transacciones</li>
                <li>• Estatus: &quot;PA&quot;</li>
                <li>• importeTxn como string</li>
                <li>• Incluye campo &quot;tipo&quot; (VEHICULAR, etc.)</li>
              </ul>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <h4 className="font-medium text-green-800 mb-2">V2 (Actual)</h4>
              <ul className="text-sm text-green-700 space-y-1">
                <li>• Estructura: pago individual por evento</li>
                <li>• Estatus: &quot;PAGADO&quot;</li>
                <li>• importeTxn como número</li>
                <li>• Campo &quot;movimiento&quot; (DENOM, DEHOS, etc.)</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
