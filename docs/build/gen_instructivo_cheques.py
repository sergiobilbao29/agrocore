# -*- coding: utf-8 -*-
"""Instructivos nuevos, UNO POR TEMA (estilo AgroCore):
  - Instructivo-Campos-Compartidos.pdf      (grupo economico: campos y empleados)
  - Instructivo-Carga-Varios-Lotes.pdf      (insumos/labores en varios lotes)
  - Instructivo-Importar-Cheques-PDF.pdf    (e-cheques desde el PDF del homebanking)
  - Instructivo-Sueldos-Transferencia.pdf   (pago por transferencia + detalle/recibo)
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(BASE, "Instructivos")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=20, textColor=G900, spaceAfter=2, leading=24)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_h3    = S("h3", fontName="Helvetica-Bold", fontSize=11.5, textColor=G900, spaceBefore=8, spaceAfter=3, leading=15)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

KIND = {"g": (G100, G600, G900), "a": (AMBER_BG, AMBER_BD, AMBER_TX), "b": (BLUE_BG, BLUE_BD, BLUE_TX)}

def callout(text, kind="g"):
    bg, bd, tx = KIND[kind]
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=1, spaceAfter=1)

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Instructivo")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazón del negocio agrícola")
    canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page)
    canvas.restoreState()

def build(filename, title, subtitle, blocks):
    out = os.path.join(OUTDIR, filename)
    doc = BaseDocTemplate(out, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = [Paragraph(title, st_title), Paragraph(subtitle, st_sub)]
    for kind, val in blocks:
        if kind == "intro":   E.append(Paragraph(val, st_intro))
        elif kind == "h2":    E.append(Paragraph(val, st_h2))
        elif kind == "h3":    E.append(Paragraph(val, st_h3))
        elif kind == "steps": E.append(steps(val))
        elif kind == "bullets": E.append(bullets(val))
        elif kind == "call":  E.append(callout(val[0], val[1]))
        elif kind == "faq":
            E.append(Paragraph("Preguntas frecuentes", st_h2))
            for q, a in val:
                E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))
    doc.build(E)
    print("PDF generado:", out)

# ============================================================
# MANEJO COMPLETO DE CHEQUES (propios y de terceros)
# ============================================================
build("Instructivo-Cheques-Propios-y-Terceros.pdf",
  "Manejo completo de cheques",
  "Cheques propios y de terceros: de la carga al cobro, pago, depósito, endoso, venta y transferencia entre empresas",
  [
    ("intro", "Esta guía explica todo el circuito de cheques en AgroCore: los de terceros (los que recibís) y los propios (los "
              "que emitís). Cómo cargarlos, depositarlos, acreditarlos/cobrarlos, usarlos para pagar, venderlos/descontarlos "
              "en el banco, transferirlos a otra empresa del grupo, y cómo impactan en el saldo."),

    ("h2", "Los dos circuitos de un vistazo"),
    ("call", ("<b>Cheque de terceros (lo recibís):</b> En cartera &rarr; Depositado (en tránsito) &rarr; Cobrado (acredita).<br/>"
              "<b>Cheque propio (lo emitís):</b> Emitido &rarr; Entregado al proveedor &rarr; Pagado (debita banco).", "b")),

    ("h2", "1 . Conceptos básicos"),
    ("bullets", [
        "<b>Tipo:</b> Propio (lo emitís vos, de tu chequera) o de terceros (lo recibís de un cliente, queda en tu cartera).",
        "<b>Formato:</b> Físico (papel) o Electrónico (e-cheq).",
        "<b>Librador / titular:</b> Quién libró el cheque (el que lo firma). En los de terceros, tu cliente.",
        "<b>Beneficiario:</b> A quién fue el cheque (a quién se lo entregaste, si lo endosás).",
        "<b>Endosante:</b> De quién te vino el cheque (quién te lo endosó/entregó).",
        "<b>En poder de:</b> Solo físicos: dónde está el papel (caja oficina, una persona, etc.).",
        "<b>Estados:</b> en cartera, emitido, endosado/entregado, depositado, cobrado, pagado, rechazado, vendido, "
        "transferido, anulado.",
    ]),
    ("call", ("Los estados son configurables: en <b>Cheques &rarr; Estados</b> podés agregar, renombrar o quitar estados "
              "propios.", "g")),

    ("h2", "2 . Cargar un cheque"),
    ("bullets", [
        "Entrá a <b>Tesorería &rarr; Cheques</b> y tocá <b>+ Nuevo</b>. Elegís tipo (propio/terceros), formato, banco, número, "
        "fechas de emisión y pago, monto, librador y demás. Los campos que no aplican según el tipo se ponen en gris.",
        "También podés importar e-cheques desde el <b>PDF del homebanking</b>: en <b>Tesorería &rarr; Cheques</b>, tocá "
        "<b>\U0001F4C4 Importar PDF</b> y subí el PDF del e-cheq (Galicia y similares). El sistema lee N°, importe, banco, fechas, "
        "librador/beneficiario, CUIT y motivo, detecta si es <b>propio</b> o <b>de terceros</b>, acepta <b>varios a la vez</b> y "
        "<b>avisa duplicados</b>. (Hay un instructivo dedicado: <b>Importar e-cheques desde el PDF</b>.)",
        "Un cheque de terceros recién cargado queda <b>en cartera</b> (disponible para usar).",
    ]),

    ("h2", "3 . Cheques de terceros (los que recibís)"),
    ("h3", "a) Depositar y acreditar (cobrar)"),
    ("bullets", [
        "<b>Depositar:</b> desde <b>Bancos &rarr; la cuenta &rarr; Depositar cheque</b> (o desde Cheques). Pasa a depositado "
        "(en tránsito) y todavía NO suma al saldo, porque puede rechazarse.",
        "<b>Acreditar / cobrar:</b> cuando el banco lo acredita, en Cheques usá el botón <b>Acreditar</b> (icono verde), elegí la "
        "cuenta y confirmalo como cobrado: recién ahí suma al saldo.",
        "<b>Rechazado:</b> si el banco lo rechaza, marcalo como rechazado (no acredita nada).",
    ]),
    ("call", ("Cambiar el estado a &lsquo;cobrado&rsquo; editando el cheque NO genera el movimiento bancario. Para que impacte "
              "en el saldo hay que usar el botón <b>Acreditar</b> (que pide la cuenta).", "a")),
    ("h3", "b) Usar el cheque para pagar (endosar)"),
    ("bullets", [
        "En <b>Comercial &rarr; Cuentas a pagar &rarr; Pagar</b>, elegí el método <b>Cheque</b> y seleccionalo de tu cartera. Se "
        "endosa/entrega al proveedor y sale de cartera.",
        "Podés pagar con varios cheques a la vez, o mezclar cheques + efectivo + transferencia en un mismo pago.",
    ]),

    ("h2", "4 . Vender / descontar cheques en el banco"),
    ("intro", "Cuando llevás cheques de terceros al banco (o a una financiera) para cobrarlos antes del vencimiento, el banco "
              "te adelanta la plata y te descuenta un interés. Eso es <b>vender / descontar cheques</b>."),
    ("bullets", [
        "En Cheques, botón <b>Vender cheques</b>: tildá los cheques que entregás al banco (podés seleccionar varios juntos).",
        "Elegí la cuenta bancaria donde te acreditan y cargá el <b>neto realmente acreditado</b> (lo que efectivamente te "
        "quedó después de que el banco descuente interés, comisión e impuestos).",
        "El sistema calcula solo el gasto financiero (suma de los cheques &minus; neto), acredita el neto en la cuenta y "
        "registra ese gasto como un cargo bancario. Los cheques salen de cartera y quedan en estado <b>vendido</b>.",
        "Opcional: anotá la tasa y el plazo promedio para tener el costo financiero de la operación.",
    ]),
    ("call", ("<b>Diferencia clave:</b> depositar es mandarlo a cobrar al vencimiento (suma el total cuando acredita). "
              "Vender/descontar es cobrarlo anticipado: suma el neto ahora y el interés queda como gasto. Usá venta cuando "
              "necesitás la plata antes.", "b")),

    ("h2", "5 . Transferir un cheque a otra empresa del grupo"),
    ("intro", "Si manejás varias empresas en AgroCore y un cheque de terceros que está en la cartera de una lo vas a "
              "usar/cobrar con otra, no hace falta borrarlo y volver a cargarlo: lo transferís y viaja de una cartera a la otra."),
    ("bullets", [
        "En <b>Tesorería &rarr; Cheques</b>, cada cheque de terceros en cartera tiene el botón <b>Transferir</b>.",
        "Elegís la empresa destino del grupo y confirmás. El cheque sale de la cartera de la empresa actual y queda como "
        "&ldquo;Transferido a otra empresa&rdquo;.",
        "En la empresa destino aparece en cartera, con una nota de dónde vino. Desde ahí esa empresa lo puede depositar, "
        "cobrar, vender o volver a transferir, como cualquier cheque propio de su cartera.",
        "Sirve para ordenar el circuito real cuando una empresa recibe el cheque pero otra es la que lo deposita o lo usa "
        "para pagar.",
    ]),
    ("call", ("¿Cuándo conviene transferir en vez de endosar como pago? Transferir mueve el cheque entre tus propias "
              "empresas (mismo grupo) para que quede en la cartera correcta. Endosar/entregar es cuando se lo pasás a un "
              "proveedor externo como pago. Si el cheque tiene que quedar en otra de tus firmas, transferí. Si sale a pagarle "
              "a un tercero, endosá en el pago.", "g")),

    ("h2", "6 . Cheques propios (los que emitís)"),
    ("bullets", [
        "Se cargan como cheque propio (con la cuenta bancaria de tu chequera) o directamente al pagar a un proveedor: en "
        "el método Cheque podés crear el cheque propio nuevo en la misma pantalla (número, fecha de pago, monto) y se "
        "entrega en un solo paso.",
        "El cheque propio queda entregado al proveedor. El saldo del banco NO baja todavía: baja cuando el banco lo debita, "
        "momento en que lo marcás como pagado (botón Acreditar/Pagar, eligiendo la cuenta).",
    ]),
    ("call", ("Igual que con los de terceros: el propio impacta el saldo cuando queda &lsquo;pagado&rsquo; (debitado), no "
              "cuando lo entregás.", "a")),

    ("h2", "7 . Cómo impacta en el saldo del banco"),
    ("bullets", [
        "<b>Cheque de terceros en cartera / depositado:</b> No impacta todavía (está por cobrarse).",
        "<b>Cheque de terceros cobrado / acreditado:</b> SUMA al saldo (ingreso).",
        "<b>Cheque propio entregado:</b> No impacta todavía.",
        "<b>Cheque propio pagado (debitado):</b> RESTA del saldo (egreso).",
        "<b>Venta / descuento de cheques:</b> SUMA el neto (y registra el gasto financiero como cargo).",
        "<b>Transferencia a otra empresa:</b> No mueve saldo: solo cambia de cartera (empresa).",
    ]),

    ("h2", "8 . Extras útiles"),
    ("bullets", [
        "<b>Filtros y columnas:</b> filtrá por banco, cuenta, número, tipo y estado; con <b>Columnas</b> mostrás/ocultás y "
        "reordenás columnas.",
        "La pantalla de Cheques <b>arranca mostrando solo los &ldquo;En cartera&rdquo;</b>; para ver los <b>emitidos</b>, "
        "<b>depositados</b> o <b>transferidos</b>, poné el filtro <b>Estado &rarr; Todos</b> (o usá &ldquo;Ver todos los "
        "cheques&rdquo; cuando la lista queda vacía).",
        "<b>Exportar:</b> la lista de cheques se baja a Excel y a PDF respetando los filtros activos.",
        "<b>Conciliación bancaria:</b> al cerrar un mes de una cuenta, sus movimientos (incluidos los de cheques) quedan "
        "bloqueados hasta reabrir.",
        "<b>Avisos en el Calendario:</b> aviso 15 días antes del vencimiento y recordatorio 7 días después para revisar si el "
        "cheque se pagó o se rechazó.",
        "<b>Fechas:</b> se muestran tal cual las cargaste (sin corrimientos de zona horaria).",
    ]),
  ])
