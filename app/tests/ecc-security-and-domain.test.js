import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeExcelCell, sanitizeExcelRow } from '../src/utils/excelSanitizer.js';
import {
  validateUploadedFile,
  validateFileMagicBytes,
  sanitizeTextInput,
  checkRateLimit,
  resetRateLimit,
} from '../src/utils/security.js';
import { createInstrumentedFetch, clearTelemetry } from '../src/utils/telemetry.js';
import { TIPOS_DOC_PERMITIDOS } from '../src/utils/compras/catalogos.js';
import { validarDocumentoCompras } from '../src/utils/compras/reglas.js';
import { clearPersistedQueryCache } from '../src/utils/queryPersister.js';
import { getNetworkProfile, simulateNetworkProfile } from '../src/utils/networkProfile.js';
import { executeParallelBatches } from '../src/utils/jobQueue.js';
import { fetchAllSupabaseKeyset } from '../src/utils/supabasePagination.js';
import { parsearSapVentasStreaming } from '../src/utils/ventas/lectores.js';
import { aFilaBDRpc } from '../src/utils/ventas/persistencia.js';

describe('ECC Security — Excel Formula Injection & Input Sanitization', () => {
  it('prefija con comilla simple fórmulas peligrosas en celdas Excel', () => {
    assert.equal(sanitizeExcelCell('=CMD|\' /C calc\'!A0'), '\'=CMD|\' /C calc\'!A0');
    assert.equal(sanitizeExcelCell('+1+1'), '\'+1+1');
    assert.equal(sanitizeExcelCell('-2+3'), '\'-2+3');
    assert.equal(sanitizeExcelCell('@SUM(A1:A2)'), '\'@SUM(A1:A2)');
    assert.equal(sanitizeExcelCell('\t123'), '\'\t123');
    assert.equal(sanitizeExcelCell('PARDOS CHICKEN SAC'), 'PARDOS CHICKEN SAC');
    assert.equal(sanitizeExcelCell(123.45), 123.45);
  });

  it('sanitiza filas completas sin mutar el objeto original', () => {
    const raw = { Nombre: '=HYPERLINK("http://evil")', Total: 100 };
    const clean = sanitizeExcelRow(raw);
    assert.equal(clean.Nombre, '\'=HYPERLINK("http://evil")');
    assert.equal(clean.Total, 100);
    assert.equal(raw.Nombre, '=HYPERLINK("http://evil")');
  });

  it('remueve etiquetas HTML y caracteres de control en entradas de texto', () => {
    assert.equal(sanitizeTextInput('  <script>alert(1)</script>\u0000hola  '), 'scriptalert(1)/scripthola');
    assert.equal(sanitizeTextInput('abcdef', 3), 'abc');
  });
});

describe('ECC Security — File Validation & Magic Bytes', () => {
  it('valida extensión y tamaño en validateUploadedFile', () => {
    assert.equal(validateUploadedFile({ name: 'reporte.txt', size: 100, type: 'text/plain' }, 'txt').valid, true);
    assert.equal(validateUploadedFile({ name: 'reporte_grande.txt', size: 400 * 1024 * 1024, type: 'text/plain' }, 'txt').valid, true);
    assert.equal(validateUploadedFile({ name: 'reporte_excedido.txt', size: 400 * 1024 * 1024 + 1, type: 'text/plain' }, 'txt').valid, false);
    assert.equal(validateUploadedFile({ name: 'malware.exe', size: 100, type: '' }, 'txt').valid, false);
    assert.equal(validateUploadedFile({ name: 'vacio.txt', size: 0, type: 'text/plain' }, 'txt').valid, false);
    assert.equal(validateUploadedFile({ name: 'cortesias.xlsx', size: 1024, type: '' }, 'excel').valid, true);
    assert.equal(validateUploadedFile({ name: 'cortesias_grande.xlsx', size: 400 * 1024 * 1024, type: '' }, 'excel').valid, true);
    assert.equal(validateUploadedFile({ name: 'cortesias_excedido.xlsx', size: 400 * 1024 * 1024 + 1, type: '' }, 'excel').valid, false);
  });

  it('rechaza binarios disfrazados de .txt y valida firmas ZIP/OLE2 en Excel', () => {
    const validTxt = new TextEncoder().encode('20260600|CUO1|M001|01/06/2026|').buffer;
    assert.equal(validateFileMagicBytes(validTxt, 'txt').valid, true);

    const fakeExe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]).buffer;
    assert.equal(validateFileMagicBytes(fakeExe, 'txt').valid, false);

    const fakePdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
    assert.equal(validateFileMagicBytes(fakePdf, 'txt').valid, false);

    const validXlsx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]).buffer;
    assert.equal(validateFileMagicBytes(validXlsx, 'excel').valid, true);

    const validXls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]).buffer;
    assert.equal(validateFileMagicBytes(validXls, 'excel').valid, true);

    const fakeExcel = new TextEncoder().encode('not-an-excel-file').buffer;
    assert.equal(validateFileMagicBytes(fakeExcel, 'excel').valid, false);
  });

  it('bloquea peticiones tras exceder el rate limit configurado', () => {
    const key = 'test_ecc_rl';
    resetRateLimit(key);
    assert.equal(checkRateLimit(key, { maxAttempts: 2, windowMs: 10000, lockoutMs: 5000 }).allowed, true);
    assert.equal(checkRateLimit(key, { maxAttempts: 2, windowMs: 10000, lockoutMs: 5000 }).allowed, true);
    assert.equal(checkRateLimit(key, { maxAttempts: 2, windowMs: 10000, lockoutMs: 5000 }).allowed, false);
    resetRateLimit(key);
  });
});

describe('ECC Networking & Cache — Telemetry keepalive & QueryPersister', () => {
  it('desactiva keepalive en POST/RPC para evitar límite de 64 KB y lo mantiene en GET', async () => {
    clearTelemetry();
    const calls = [];
    const mockFetch = async (url, init) => {
      calls.push({ url, method: init.method || 'GET', keepalive: init.keepalive });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const instrumented = createInstrumentedFetch({
      baseFetch: mockFetch,
      primaryUrl: 'https://demo.supabase.co',
    });

    await instrumented('https://demo.supabase.co/rest/v1/rpc/insertar_lote_ventas', {
      method: 'POST',
      body: JSON.stringify({ p_filas: [] }),
    });
    await instrumented('https://demo.supabase.co/rest/v1/empresas?select=id', {
      method: 'GET',
    });

    assert.equal(calls[0].keepalive, false, 'POST a RPC nunca debe usar keepalive: true');
    assert.equal(calls[1].keepalive, true, 'GET puede usar keepalive: true');
  });

  it('clearPersistedQueryCache ejecuta de forma segura sin navegador', async () => {
    await assert.doesNotReject(() => clearPersistedQueryCache());
  });
});

describe('ECC Domain — Compras Nota de Débito SUNAT (08) y SAP (09)', () => {
  it('acepta tipos 01, 07, 08, 09 y 14 sin disparar ERROR 8', () => {
    for (const tipo of ['01', '07', '08', '09', '14']) {
      assert.equal(TIPOS_DOC_PERMITIDOS.has(tipo), true, `Tipo ${tipo} debe estar permitido`);
    }

    const docND08 = {
      en_sap: true,
      en_sunat: true,
      tipo_doc_pago: '08',
      clave_legible: '20100047218-08-FD01-0001',
      sap: { tipo_doc_pago: '08', fecha_emision: '2026-06-15', tipo_identidad: '6', nro_identidad: '20100047218', base: 10000, igv: 1800, valor_adquisicion: 0, otros: 0, total: 11800 },
      sunat: { tipo_doc_pago: '08', fecha_emision: '2026-06-15', tipo_identidad: '6', nro_identidad: '20100047218', base: 10000, igv: 1800, valor_adquisicion: 0, otros: 0, total: 11800 },
    };
    const res = validarDocumentoCompras(docND08);
    assert.equal(res.resultado, 'OK');
    assert.equal(res.codigosError.length, 0);
  });
});

describe('Carga masiva progresiva y resiliencia ante timeouts', () => {
  it('configura lotes progresivos (500) y concurrencia controlada (2) en conexiones normales', () => {
    simulateNetworkProfile(null);
    const normal = getNetworkProfile();
    assert.equal(normal.recommendedBatchSize, 500);
    assert.equal(normal.recommendedConcurrency, 2);
    assert.equal(normal.recommendedBulkUploadBatchSize, 2000);
    assert.equal(normal.recommendedBulkUploadConcurrency, 4);
    assert.equal(normal.recommendedReadPageSize, 1000);
    assert.equal(normal.recommendedReadRpcLimit, 5000);
    assert.equal(normal.recommendedReadConcurrency, 4);

    simulateNetworkProfile({ isSlowNetwork: true, effectiveType: '2g' });
    const slow = getNetworkProfile();
    assert.equal(slow.recommendedBatchSize, 250);
    assert.equal(slow.recommendedConcurrency, 1);
    assert.equal(slow.recommendedBulkUploadBatchSize, 500);
    assert.equal(slow.recommendedBulkUploadConcurrency, 1);
    assert.equal(slow.recommendedReadPageSize, 500);
    assert.equal(slow.recommendedReadRpcLimit, 2000);
    assert.equal(slow.recommendedReadConcurrency, 2);
    simulateNetworkProfile(null);
  });

  it('parsearSapVentasStreaming y aFilaBDRpc procesan en streaming con payload compacto', async () => {
    const line = [
      '20261100', 'CUO1', 'M001', '22/11/2026', '', '03', 'B601', '0000123', '', '1',
      '45401715', 'JUAN PEREZ', '', '100.00', '', '18.00', '', '0.00', '0.00', '',
      '', '', '0.00', '0.00', '118.00', '', '', '', '', '', '', '', '', '', '1',
    ].join('|');
    const buf = new TextEncoder().encode(`${line}\r\n${line.replace('0000123', '0000124')}\r\n`).buffer;
    const res = await parsearSapVentasStreaming(buf);
    assert.equal(res.estado, 'ok');
    assert.equal(res.registrosValidos, 2);
    assert.equal(res.periodoDetectado, '202611');

    const compact = aFilaBDRpc(
      {
        tipo_doc_pago: '03',
        serie: 'B601',
        correlativo: '123',
        fecha_emision: '2026-11-22',
        estado: 'OK',
        en_sap: true,
        en_sunat: true,
        anulado: false,
        cortesia: null,
        incidencias: [],
        sap: { tipo_identidad: '1', nro_identidad: '45401715', nombre: 'JUAN PEREZ', correlativo: '0000123', fecha_emision: '2026-11-22', base: 10000, igv: 1800, exonerado: 0, inafecto: 0, otros: 0, total: 11800, linea: 1, estado: '1' },
        sunat: { tipo_identidad: '1', nro_identidad: '45401715', nombre: 'JUAN PEREZ', correlativo: '123', fecha_emision: '2026-11-22', base: 10000, igv: 1800, exonerado: 0, inafecto: 0, otros: 0, total: 11800, op_gratuitas: 0, linea: 2, estado: '1' },
      },
      { ruc: '20553596441' }
    );
    assert.equal('periodo_id' in compact, false, 'aFilaBDRpc debe omitir periodo_id redundante');
    assert.equal('empresa_id' in compact, false, 'aFilaBDRpc debe omitir empresa_id redundante');
    assert.equal('exonerado_sap' in compact, false, 'aFilaBDRpc debe omitir montos en 0');
    assert.equal(compact.total_sap, 118);
  });

  it('fetchAllSupabaseKeyset descarga por buckets UUID vía RPC y hace fallback keyset por car_sunat si la RPC no existe', async () => {
    const hexPrefixes = ['1', '5', '9', 'd'];
    const dataset = Array.from({ length: 12000 }, (_, i) => {
      const prefix = hexPrefixes[i % 4];
      const suffix = String(i).padStart(12, '0');
      return {
        id: `${prefix}0000000-0000-4000-8000-${suffix}`,
        car_sunat: `2055359644103B601${String(i + 1).padStart(10, '0')}`,
      };
    });

    // 1. Vía rápida: RPC Keyset por buckets UUID paralelos
    let rpcCalls = 0;
    const rpcResult = await fetchAllSupabaseKeyset({
      rpcLimit: 2000,
      concurrency: 4,
      fetchCount: async () => ({ count: dataset.length, error: null }),
      fetchRpcBatch: async ({ minId, maxId, afterId, limit }) => {
        rpcCalls += 1;
        const rows = dataset
          .filter((r) => {
            if (minId && r.id < minId) return false;
            if (maxId && r.id > maxId) return false;
            if (afterId && r.id <= afterId) return false;
            return true;
          })
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .slice(0, limit);
        return { data: rows, error: null };
      },
    });
    assert.equal(rpcResult.length, dataset.length, 'RPC keyset por buckets debe devolver todas las 12,000 filas sin pérdida');
    assert.ok(rpcCalls <= 8, '12,000 filas en buckets de 2,000 deben completarse en <= 8 llamadas RPC');

    // 2. Fallback automático sin migración: RPC inexistente (PGRST202) -> keyset por car_sunat sin OFFSET
    let keysetCalls = 0;
    const sortedByCar = [...dataset].sort((a, b) => (a.car_sunat < b.car_sunat ? -1 : 1));
    const fallbackResult = await fetchAllSupabaseKeyset({
      pageSize: 1000,
      rpcLimit: 5000,
      concurrency: 4,
      fetchCount: async () => ({ count: dataset.length, error: null }),
      fetchRpcBatch: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
      fetchCarKeysetPage: async (lastCar, limit) => {
        keysetCalls += 1;
        const rows = sortedByCar.filter((r) => (lastCar === null ? true : r.car_sunat > lastCar)).slice(0, limit);
        return { data: rows, error: null };
      },
      fetchNullCarPage: async () => ({ data: [], error: null }),
    });
    assert.equal(fallbackResult.length, dataset.length, 'Fallback car_sunat keyset debe recuperar las 12,000 filas sin OFFSET');
    assert.equal(keysetCalls, 13, '12,000 filas en bloques de 1,000 con cursor deben completar en 12 páginas + cierre');

    // 3. Cancelación inmediata vía AbortSignal
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        fetchAllSupabaseKeyset({
          signal: controller.signal,
          fetchCount: async () => ({ count: 10, error: null }),
        }),
      (err) => err?.name === 'AbortError'
    );
  });

  it('executeParallelBatches detiene lotes en cola tras el primer error fatal', async () => {
    const ejecutados = [];
    const items = [1, 2, 3, 4, 5, 6];
    await assert.rejects(
      () =>
        executeParallelBatches(
          items,
          1,
          async ([item]) => {
            ejecutados.push(item);
            if (item === 2) {
              throw new Error('Fallo simulado');
            }
            await new Promise((r) => setTimeout(r, 15));
          },
          { concurrency: 1, label: 'TestAbort' }
        ),
      /Fallo simulado/
    );
    assert.deepEqual(ejecutados, [1, 2]);
  });
});
