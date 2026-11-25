# -*- coding: utf-8 -*-
"""Instructivo: Caravanas electrónicas (RFID) (estilo AgroCore).
  - Instructivo-Caravanas-Electronicas-RFID.pdf
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
# CARAVANAS ELECTRÓNICAS (RFID)
# ============================================================
build("Instructivo-Caravanas-Electronicas-RFID.pdf",
  "Caravanas electrónicas (RFID)",
  "Identificar, pesar y controlar la hacienda por caravana, sin cargar una ficha por animal.",
  [
    ("h2", "¿Para qué sirve?"),
    ("bullets", [
        "En feedlot y rodeos grandes, maneja cada caravana como un registro liviano dentro del lote (no hace falta una ficha por animal).",
        "El pesaje por bastón aplica cada peso al animal por su RFID y recalcula el lote solo; te avisa qué caravanas no se pesaron.",
        "En cabaña, cría y haras, la Ficha individual guarda la evolución de peso (GDP), sanidad y genealogía.",
    ]),
    ("h2", "Dónde está"),
    ("intro", "En <b>Ganadería y Haras &rarr; Rodeos y Hacienda</b>. Abrí el lote/rodeo: dentro vas a ver los botones de caravanas."),
    ("h2", "Paso a paso (feedlot / rodeos)"),
    ("steps", [
        "<b>Importar las caravanas del lote.</b> Dentro del lote, tocá <b>Importar caravanas</b> y subí el archivo que exporta el bastón lector (Allflex, Tru-Test, Gallagher, Datamars) al dar el ingreso de la tropa. AgroCore crea todas las caravanas y las asigna al lote de una. Si una caravana ya existía, la mueve a este lote. Opcional: especie, categoría y costo de ingreso.",
        "<b>Pesar por caravana.</b> Tocá <b>Pesaje por caravana</b> y subí el archivo de pesaje del bastón con balanza. El sistema lee cada RFID, sabe solo a qué lote pertenece, aplica el peso al animal, registra el pesaje del lote y recalcula el promedio. No tenés que elegir el lote a mano.",
        "<b>Revisar faltantes y desconocidas.</b> Al terminar, AgroCore muestra: cuántos se pesaron, el resumen por lote, las caravanas leídas que no están en el sistema (importalas primero) y las faltantes (activas del lote que no se pesaron). En las faltantes podés marcar <b>muerto</b> o <b>extraviado</b> (dan de baja y descuentan del lote) o dejar pendientes.",
        "<b>Ficha individual: peso y GDP (cabaña / cría / haras).</b> Para animales de valor, abrí su <b>Ficha</b> (buscala por nombre o por caravana/RFID). Ahí vas a ver la sección <b>Evolución de peso y GDP</b>: peso actual, ganancia diaria de peso promedio (kg/día), el gráfico de la curva y la tabla de cada pesaje. También el historial de sanidad y la genealogía.",
    ]),
    ("h2", "Compatibilidad y tips"),
    ("bullets", [
        "<b>Marcas:</b> un único importador entiende Allflex, Tru-Test, Gallagher y Datamars. Detecta las columnas por nombre (RFID/EID, Visual/VID, Weight/Peso, Date/Fecha), ignora líneas de metadatos y limpia el archivo. Si el archivo es solo el RFID por renglón, igual lo toma.",
        "<b>Formato del archivo:</b> .csv o .txt separado por coma o punto y coma. El de pesaje debe traer la columna de peso.",
        "<b>Sin ficha por animal:</b> las caravanas importadas son registros livianos; la ficha completa queda para los animales que la necesitan.",
        "<b>Pesaje a mano:</b> si no tenés bastón, podés cargar el peso en la ficha del animal y usar <b>Pesaje desde balanzas</b> para armar el pesaje del lote.",
    ]),
    ("call", ("¿Dudas? WhatsApp +54 9 3582 40-8884 o consultas@agrocore.ar. También podés preguntarle al asistente de AgroCore: “cómo cargo las caravanas” o “pesaje por caravana”.", "g")),
  ])
