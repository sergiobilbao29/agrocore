# -*- coding: utf-8 -*-
"""Instructivo: Circuito de una campaña de cereal (estilo AgroCore).
Recrea Instructivo-Circuito-Campana-Cereal.pdf con ortografía correcta.
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
# CIRCUITO DE UNA CAMPAÑA DE CEREAL
# ============================================================
build("Instructivo-Circuito-Campana-Cereal.pdf",
  "Circuito de una campaña de cereal",
  "De la siembra al cobro: Soja, Maíz, Trigo, Sorgo, Girasol",
  [
    ("intro", "Esta guía recorre, paso a paso, todo el circuito de una campaña de grano de cosecha única en AgroCore: abrir "
              "la campaña, cargar insumos y labores, cosechar, mover el grano con cartas de porte, entregarlo a la cerealera, "
              "liquidarlo y cobrarlo, y ver el resultado económico."),
    ("h2", "El circuito de un vistazo"),
    ("call", ("<b>1</b> Campaña &rarr; <b>2</b> Insumos y labores &rarr; <b>3</b> Cosecha &rarr; <b>4</b> Viajes / CP &rarr; "
              "<b>5</b> Liquidación &rarr; <b>6</b> Cobro", "g")),
    ("h2", "1 . Abrir la campaña"),
    ("bullets", [
        "Entrá a <b>Producción &rarr; Campañas</b> y tocá <b>+ Nueva campaña</b>.",
        "Elegí el lote, el cultivo (Soja, Maíz...), el ciclo (ej. 25/26), las hectáreas y la fecha de siembra. Dejala en tipo "
        "<b>Cosecha única</b>.",
        "El nombre se arma solo (ciclo + cultivo + campo/lote) o lo escribís a mano.",
    ]),
    ("h2", "2 . Cargar insumos y labores (el costo de la campaña)"),
    ("bullets", [
        "Desde la card de la campaña tocá <b>Insumos/Labores</b>, o entrá a <b>Producción &rarr; Insumos y labores</b>.",
        "<b>Insumos:</b> semilla, fertilizante, fitosanitarios. Al cargarlos descuentan el stock del galpón y suman al costo de "
        "la campaña. El último costo de compra se autocompleta.",
        "<b>Labores:</b> siembra, pulverización, cosecha, con fecha y (si corresponde) el empleado o contratista.",
        "Todo queda imputado a esa campaña para el resultado económico.",
    ]),
    ("call", ("⚠ Solo se cargan insumos/labores en campañas <b>activas</b>: las <b>finalizadas</b> no aparecen en el selector. "
              "En <b>Producción &rarr; Insumos y labores</b> están <b>ocultas por defecto</b> &mdash; tildá "
              "<b>&ldquo;Ver campañas finalizadas&rdquo;</b> (arriba a la derecha) para verlas.", "a")),
    ("h2", "3 . Cosecha: el grano entra al stock"),
    ("bullets", [
        "El grano cosechado entra al stock de dos formas: como ingreso de stock manual (motivo cosecha) o "
        "directamente por los viajes (paso 4).",
        "Con eso el sistema calcula el rinde real (tn/ha) de la campaña.",
    ]),
    ("h2", "4 . Viajes y cartas de porte"),
    ("bullets", [
        "En <b>Logística &rarr; Viajes y fletes</b> cargás cada viaje con su carta de porte y CTG, kg de carga y descarga, "
        "tarifa del flete y destino (cerealera o venta directa).",
        "Podés importar la CP desde el archivo, y verificar los CTG en ARCA para traer el kg descargado.",
        "El estado avanza solo: pendiente &rarr; cargado &rarr; descargado &rarr; facturado &rarr; pagado.",
    ]),
    ("call", ("Si vendés por un contrato, cargalo en <b>Stock y depósitos &rarr; Contratos de cereal</b> e imputá los viajes: el tablero te "
              "muestra cuánto entregaste y cuánto falta.", "b")),
    ("h2", "5 . Cerealera, posición y liquidación"),
    ("bullets", [
        "En <b>Stock &rarr; Posición de granos</b> ves por especie lo entregado, lo liquidado y lo que falta liquidar, valuado a "
        "pizarra.",
        "Cuando llega la liquidación del acopio/exportador, entra en <b>Comercial &rarr; Liquidaciones cereal</b>: podés "
        "importar el PDF (lee kilos, gastos y retenciones) o cargarla a mano.",
        "La liquidación arma el neto a cobrar y la cuenta a cobrar del comprador.",
    ]),
    ("h2", "6 . Cobro"),
    ("bullets", [
        "Desde <b>Comercial &rarr; Cuentas a cobrar</b> cobrás la liquidación. Elegís el medio (efectivo, transferencia, cheque de "
        "terceros) y, si querés, varios medios a la vez.",
        "El cobro baja el saldo de la cuenta corriente y mueve la plata real (caja/banco).",
    ]),
    ("h2", "7 . Resultado de la campaña"),
    ("bullets", [
        "En la card de la campaña, <b>Planilla</b> arma el resultado económico: ingresos por venta menos costos de "
        "insumos, labores, flete y comercialización.",
        "En <b>Producción &rarr; Historial de campañas</b> comparás rinde, costos y margen entre campañas para decidir la "
        "próxima.",
    ]),
    ("call", ("AgroCore . Circuito de campaña de cereal . Uso interno / clientes", "g")),
  ])
