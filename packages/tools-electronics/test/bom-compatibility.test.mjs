import test from "node:test";
import assert from "node:assert/strict";
import { validateBillOfMaterials, validateElectricalCompatibility } from "../dist/index.js";

const pricedPart = (overrides = {}) => ({
  reference: "U1", manufacturer: "Acme", mpn: "ACME-1", quantity: 1,
  unitPrice: 2.5, currency: "USD", sourceUrl: "https://shop.example/acme-1",
  checkedAt: "2026-11-20T09:00:00.000Z", datasheetUrl: "https://example.com/acme-1.pdf",
  ...overrides,
});

test("BOM cost is grouped by currency and keeps delivery, reserve, and unknown prices distinct", () => {
  const report = validateBillOfMaterials({
    items: [pricedPart(), pricedPart({ reference: "R1", quantity: 4, unitPrice: null, sourceUrl: undefined, checkedAt: undefined, datasheetUrl: undefined })],
    delivery: [{ amount: 3, currency: "USD" }], reservePercent: 10,
  });
  assert.equal(report.status, "NEEDS_DATASHEET");
  assert.deepEqual(report.costs[0], { currency: "USD", subtotal: 2.5, delivery: 3, reserve: 0.55, knownTotal: 6.05 });
  assert.deepEqual(report.unknownPriceReferences, ["R1"]);
  assert.ok(report.unconfirmedParameters.some(entry => entry.parameter === "R1.datasheetUrl"));
});

test("BOM reports component reference mismatches against KiCad netlist", () => {
  const report = validateBillOfMaterials({ items: [pricedPart()], kicadReferences: ["U1", "R1"] });
  assert.equal(report.status, "NEEDS_REVIEW");
  assert.deepEqual(report.netlistReconciliation, { bomOnly: [], netlistOnly: ["R1"] });
});

test("empty BOM and electrical scopes never report a passing result", () => {
  assert.equal(validateBillOfMaterials({ items: [] }).status, "NEEDS_REVIEW");
  const electrical = validateElectricalCompatibility({ components: [], supplies: [], loads: [], interfaces: [], connections: [] });
  assert.equal(electrical.status, "NEEDS_REVIEW");
});

test("a 5 V sensor output connected to a 3.3 V-only GPIO is UNSAFE", () => {
  const report = validateElectricalCompatibility({
    components: [
      { id: "MCU", datasheetUrl: "https://example.com/mcu.pdf", gpio: { maxVoltage: 3.3, maxCurrent: 0.01 } },
      { id: "SENSOR", datasheetUrl: "https://example.com/sensor.pdf", pins: [{ name: "OUT", maxVoltage: 5 }] },
    ],
    supplies: [], loads: [], interfaces: [],
    connections: [{ componentId: "SENSOR", pin: "OUT", net: "DATA", voltage: 5, direction: "output", gpio: { componentId: "MCU", pin: "PA0" } }],
  });
  assert.equal(report.status, "UNSAFE");
  assert.ok(report.findings.some(item => item.code === "GPIO_OVERVOLTAGE"));
});

test("pump connected directly to a GPIO is UNSAFE without a rated driver path", () => {
  const report = validateElectricalCompatibility({
    components: [{ id: "MCU", datasheetUrl: "https://example.com/mcu.pdf", gpio: { maxVoltage: 3.3, maxCurrent: 0.02 } }, { id: "PUMP", datasheetUrl: "https://example.com/pump.pdf" }],
    supplies: [], interfaces: [], connections: [],
    loads: [{ componentId: "PUMP", kind: "pump", current: 0.4, gpioDirect: true, gpioComponentId: "MCU", driverComponentId: null, requiredProtection: ["flyback"] }],
  });
  assert.equal(report.status, "UNSAFE");
  assert.ok(report.findings.some(item => item.code === "GPIO_LOAD_REQUIRES_DRIVER"));
  assert.ok(report.findings.some(item => item.code === "DRIVER_NOT_SPECIFIED"));
});

test("load current above a documented driver rating is UNSAFE", () => {
  const report = validateElectricalCompatibility({
    components: [
      { id: "DRV1", datasheetUrl: "https://example.com/driver.pdf", driver: { maxCurrent: 0.2 } },
      { id: "FAN1", datasheetUrl: "https://example.com/fan.pdf" },
    ],
    supplies: [{ id: "PS1", voltage: 12, ratedCurrent: 2 }], interfaces: [], connections: [],
    loads: [{ componentId: "FAN1", kind: "motor", supplyId: "PS1", voltageMin: 9, voltageMax: 14, current: 0.5, driverComponentId: "DRV1", requiredProtection: ["flyback"], protectionPresent: ["flyback"], dissipation: 0.2, thermalLimit: 0.4 }],
  });
  assert.equal(report.status, "UNSAFE");
  assert.ok(report.findings.some(item => item.code === "DRIVER_CURRENT_EXCEEDED"));
});

test("duplicate GPIO assignment and missing supply rating fail closed", () => {
  const report = validateElectricalCompatibility({
    components: [{ id: "MCU", datasheetUrl: "https://example.com/mcu.pdf", gpio: { maxVoltage: 3.3, maxCurrent: 0.02 } }, { id: "A", datasheetUrl: "https://example.com/a.pdf" }, { id: "B", datasheetUrl: "https://example.com/b.pdf" }],
    supplies: [{ id: "PS1", voltage: 5, ratedCurrent: null }], loads: [], interfaces: [],
    connections: [
      { componentId: "A", pin: "OUT", net: "A_OUT", voltage: 3.3, direction: "output", gpio: { componentId: "MCU", pin: "PA1" } },
      { componentId: "B", pin: "OUT", net: "B_OUT", voltage: 3.3, direction: "output", gpio: { componentId: "MCU", pin: "PA1" } },
    ],
  });
  assert.equal(report.status, "UNSAFE");
  assert.ok(report.findings.some(item => item.code === "GPIO_PIN_CONFLICT"));
  assert.ok(report.unconfirmedParameters.some(item => item.parameter === "PS1.ratedCurrent"));
});

test("missing datasheets remain NEEDS_DATASHEET and interface pull-up uncertainty needs review", () => {
  const report = validateElectricalCompatibility({
    components: [{ id: "MCU", gpio: { maxVoltage: 3.3, maxCurrent: 0.02 } }, { id: "EEPROM" }],
    supplies: [], loads: [], connections: [],
    interfaces: [{ protocol: "I2C", from: "MCU", to: "EEPROM", pullupsRequired: true, pullupsPresent: null, levelShifterRequired: null, levelShifterPresent: null }],
  });
  assert.equal(report.status, "NEEDS_DATASHEET");
  assert.ok(report.unconfirmedParameters.some(item => item.parameter === "MCU.datasheetUrl"));
  assert.ok(report.findings.some(item => item.code === "I2C_PULLUP_UNKNOWN"));
});

test("electrical report emits machine-readable connections and KiCad netlist discrepancies", () => {
  const report = validateElectricalCompatibility({
    components: [{ id: "U1", datasheetUrl: "https://example.com/u1.pdf" }], supplies: [], loads: [], interfaces: [],
    connections: [{ componentId: "U1", pin: "1", net: "VCC", voltage: 3.3, direction: "input" }],
    kicadNetlistConnections: [{ componentId: "U1", pin: "1", net: "GND" }],
  });
  assert.deepEqual(report.connectionTable[0], { component: "U1", contact: "1", net: "VCC", voltage: 3.3, direction: "input" });
  assert.deepEqual(report.netlistReconciliation.designOnly, ["U1.1=VCC"]);
  assert.deepEqual(report.netlistReconciliation.netlistOnly, ["U1.1=GND"]);
  assert.equal(report.status, "NEEDS_REVIEW");
});

test("interface compatibility covers I2C, SPI, UART, and PWM plus explicit pull-up requirements", () => {
  const report = validateElectricalCompatibility({
    components: [{ id: "MCU", datasheetUrl: "https://example.com/mcu.pdf" }, { id: "PERIPHERAL", datasheetUrl: "https://example.com/p.pdf" }],
    supplies: [], loads: [], connections: [],
    interfaces: ["I2C", "SPI", "UART", "PWM"].map(protocol => ({ protocol, from: "MCU", to: "PERIPHERAL", compatible: true, pullupsRequired: protocol === "I2C", pullupsPresent: true, levelShifterRequired: false, levelShifterPresent: true })),
  });
  assert.equal(report.status, "PASS");
  assert.deepEqual(report.checkedInterfaces, ["I2C", "SPI", "UART", "PWM"]);
});
