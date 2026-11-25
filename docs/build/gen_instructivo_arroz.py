# -*- coding: utf-8 -*-
"""Instructivo: Circuito del arroz (Secadero + Pelado + Tablero)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Circuito-Arroz.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=21, textColor=G900, spaceAfter=2, leading=25)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

def callout(text, bg, bd, tx):
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

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Circuito del arroz", st_title))
    E.append(Paragraph("De la cosecha al pelado: secado con merma por humedad, pelado por molienda y tablero", st_sub))
    E.append(Paragraph(
        "AgroCore cubre el arroz de punta a punta reutilizando módulos que ya conoces y agregando el "
        "<b>Secadero</b>. El recorrido es: <b>cosecha</b> (Campañas y Viajes) &rarr; <b>Secadero</b> "
        "(el grano húmedo se seca y pierde peso por humedad) &rarr; <b>Molienda / Fábrica</b> (pelado: la "
        "cáscara seca se transforma en arroz blanco + subproductos) &rarr; <b>venta / acopio / exportación</b> "
        "(Posición de granos, Contratos de cereal, Liquidaciones). El <b>Tablero arroz</b> resume todo con "
        "rindes y costos.", st_intro))
    E.append(callout("<b>Es opt-in por empresa:</b> &nbsp; el circuito solo aparece en las empresas arroceras. "
                     "Se activa en <b>Configuración &rarr; Empresa &rarr; 'Circuito Arroz (Secadero)'</b>, o de "
                     "una sola vez con el botón <b>Preparar circuito arroz</b> (abajo).", G100, G600, G900))
    E.append(Spacer(1, 3))

    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Preparar la empresa (una sola vez)", st_h2))
    E.append(steps([
        "Entra a <b>Stock y depósitos &rarr; Secadero</b> y toca <b>Preparar circuito arroz</b>.",
        "El sistema <b>activa</b> el Secadero y la Molienda, crea los <b>artículos</b> (Arroz cáscara húmedo, "
        "cáscara seco, blanco/pulido, partido, afrechillo, cáscara) y una <b>fórmula de pelado</b> editable.",
        "Revisa la fórmula en <b>Molienda / Fábrica &rarr; Fórmulas</b> ('Pelado de arroz') y ajusta los "
        "rindes a los de tu molino (deben sumar 100%).",
    ]))
    E.append(callout("<b>Rindes orientativos de la fórmula que viene cargada:</b> &nbsp; arroz blanco 66% + "
                     "afrechillo 10% + cáscara 20% + partido 4%. Son editables.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Cosecha", st_h2))
    E.append(steps([
        "Carga la <b>campaña</b> de arroz en Producción (lote, cultivo arroz, insumos y labores) como cualquier cultivo.",
        "La <b>cosecha</b> entra por los <b>Viajes / cartas de porte</b> (o como movimiento de stock del "
        "<b>Arroz cáscara húmedo</b> si entra a tu propia planta).",
    ]))

    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Secado (Secadero)", st_h2))
    E.append(steps([
        "Entra a <b>Secadero</b> y toca <b>+ Nueva partida de secado</b>.",
        "Elegí el grano <b>húmedo</b> que entra (Arroz cáscara húmedo) y el grano <b>seco</b> que sale "
        "(Arroz cáscara seco).",
        "Carga los <b>kg húmedos</b>, la <b>humedad de entrada</b> (%) y la <b>humedad objetivo</b> "
        "(arroz ~14%). Si querés, una <b>merma extra</b> por impurezas/zarandeo.",
        "El sistema calcula los <b>kg secos</b>, da de <b>baja</b> el húmedo y de <b>alta</b> el seco en el "
        "stock, con el <b>costo del secado</b> que cargues. Si te equivocás, podés eliminar la partida y se revierte.",
    ]))
    E.append(callout("<b>Cómo se calcula la merma por humedad:</b> &nbsp; kg secos = kg húmedos x "
                     "(100 - humedad entrada) / (100 - humedad salida), menos la merma extra. "
                     "Ej.: 10.000 kg al 24% secados al 14% &rarr; 8.837 kg (merma 1.163 kg, 11,6%).",
                     AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("PASO 4 &nbsp;&mdash;&nbsp; Pelado (Molienda / Fábrica)", st_h2))
    E.append(steps([
        "Entra a <b>Molienda / Fábrica &rarr; Partes de molienda</b> y carga un parte con la fórmula "
        "<b>Pelado de arroz</b>.",
        "Poné los <b>kg de cáscara seca</b> procesados y los costos (grano + producción). El sistema "
        "descuenta la cáscara seca e ingresa <b>arroz blanco, afrechillo, cáscara y partido</b> según los "
        "rindes, con el costo por kilo de cada uno.",
        "Si querés cargar lo que <b>realmente</b> salió, tilda 'Cargar rendimiento real' y poné los kg "
        "obtenidos de cada coproducto.",
        "En <b>Costo y precio</b> cargas el % de ganancia y te sugiere el precio de venta por kilo.",
    ]))

    E.append(Paragraph("PASO 5 &nbsp;&mdash;&nbsp; Tablero y venta", st_h2))
    E.append(steps([
        "En <b>Tablero arroz</b> ves el resumen: kg que entraron húmedos, kg secos, <b>merma</b>, y los "
        "<b>coproductos</b> del pelado con su rinde y los costos de secado y pelado. Podés filtrar por fechas.",
        "La <b>venta / acopio / exportación</b> del arroz blanco y los subproductos se maneja con "
        "Posición de granos, Contratos de cereal y Liquidaciones, como con cualquier grano.",
    ]))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("Tengo una empresa mixta (arroz + hacienda). ¿Se puede?",
         "Sí. El circuito arroz es un módulo más que se activa por empresa; convive con hacienda, agricultura y lo que uses. Cada módulo se puede mostrar u ocultar por empresa."),
        ("¿El Secadero sirve para otros granos además del arroz?",
         "Sí. Es un secado genérico con merma por humedad: sirve para maíz, girasol o cualquier grano húmedo. Solo elegís los artículos de origen y destino."),
        ("¿Por qué el pelado se hace en Molienda y no en el Secadero?",
         "Porque pelar es transformar un grano en varios coproductos con un rendimiento (blanco, afrechillo, cáscara, partido), que es exactamente lo que hace la Molienda / Fábrica con su costeo. El Secadero solo cambia la humedad del mismo grano."),
        ("¿Puedo cambiar los rindes del pelado?",
         "Sí. La fórmula 'Pelado de arroz' es editable en Molienda / Fábrica -> Fórmulas. Ajusta los % a los de tu molino (deben sumar 100)."),
        ("¿Qué pasa si me equivoco en una partida de secado?",
         "La eliminás desde el Secadero y el sistema revierte el stock (vuelve el húmedo y saca el seco). Lo mismo con los partes de molienda."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
