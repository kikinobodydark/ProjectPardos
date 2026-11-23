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
    assert.equal(validateUploadedFile({ name: 'malware.exe', size: 100, type: '' }, 'txt').valid, false);
    assert.equal(validateUploadedFile({ name: 'vacio.txt', size: 0, type: 'text/plain' }, 'txt').valid, false);
    assert.equal(validateUploadedFile({ name: 'cortesias.xlsx', size: 1024, type: '' }, 'excel').valid, true);
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

    simulateNetworkProfile({ isSlowNetwork: true, effectiveType: '2g' });
    const slow = getNetworkProfile();
    assert.equal(slow.recommendedBatchSize, 250);
    assert.equal(slow.recommendedConcurrency, 1);
    simulateNetworkProfile(null);
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
