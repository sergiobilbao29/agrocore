# -*- coding: utf-8 -*-
"""Instructivo COMPLETO: cartas de porte y liquidaciones de cereal (PDF, estilo AgroCore).
De la carta de porte al cobro: cargar (manual o PDF), cargar la liquidacion, vincularlas,
descontar stock y cobrar."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Cartas-de-Porte-y-Liquidaciones.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=22, textColor=G900, spaceAfter=2, leading=26)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_h3    = S("h3", fontName="Helvetica-Bold", fontSize=11.5, textColor=G900, spaceBefore=8, spaceAfter=3, leading=15)
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
def steps(items, start=1):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+start, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)
def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletColor=G600, leftIndent=16, bulletFontSize=8, spaceBefore=2, spaceAfter=2)

def header_footer(canvas, doc):
    canvas.saveState(); w,h=A4
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
    E=[]
    E.append(Paragraph("Cartas de porte y liquidaciones de cereal", st_title))
    E.append(Paragraph("De la carta de porte al cobro: cargar, vincular, descontar stock y cobrar", st_sub))
    E.append(Paragraph(
        "En un viaje de cereal hay <b>dos cosas de plata distintas</b>, no las mezcles: "
        "<b>(1) el flete</b>, que es lo que le pagás al camionero (se cobra por el <b>peso neto transportado</b>) y "
        "<b>(2) el cereal</b>, que es lo que <b>te paga a vos</b> el acopio/comprador (se registra con la "
        "<b>liquidación</b>). Este instructivo cubre todo el circuito del cereal: cargar la carta de porte, "
        "cargar la liquidación, vincularlas, descontar el stock y cobrar.", st_intro))
    E.append(callout("<b>La merma</b> solo afecta la liquidación y los kilos acopiados. El <b>flete</b> se cobra "
                     "siempre por el peso neto transportado (sin descontar merma).", AMBER_BG, AMBER_BD, AMBER_TX))

    # PARTE 1
    E.append(Paragraph("PARTE 1 &nbsp;&mdash;&nbsp; Cargar la carta de porte (viaje)", st_h2))
    E.append(Paragraph("Opción A - A mano", st_h3))
    E.append(steps([
        "Entrá a <b>Viajes</b> y toca <b>+ Nuevo viaje</b>.",
        "<b>Datos:</b> fecha, producto (grano), origen y destino (localidad).",
        "<b>Pesos:</b> cargá el <b>Peso Neto</b> (o Tara y Bruto, que lo calculan solo). Ese es el peso que viaja.",
        "<b>Destino del cereal:</b> elegí <b>a quién le vendés</b> (Comprador) y, si aplica, <b>dónde descargás</b> "
        "(Cerealera/Destino) - pueden ser distintos. Con <b>+ nuevo</b> podés crear cualquiera de los dos sin salir.",
        "<b>Documentos:</b> número de carta de porte y CTG.",
        "Guardá. El viaje queda cargado y listo para asociarle la liquidación.",
    ]))
    E.append(Paragraph("Opción B - Importar la carta de porte por PDF de ARCA", st_h3))
    E.append(steps([
        "En <b>Viajes</b>, toca <b>Importar CP</b> y subí el PDF de la carta de porte de ARCA.",
        "El sistema crea el viaje con los datos del comprobante (fecha, producto, kg, CP, CTG, transporte).",
        "Revisá y completá el <b>comprador</b> / <b>cerealera</b> si hace falta.",
    ]))
    E.append(callout("<b>Tip CTG:</b> con el botón <b>Verificar CTGs en ARCA</b> traés el estado y los kg "
                     "descargados reales, y el viaje pasa a <b>Descargado</b>.", BLUE_BG, BLUE_BD, BLUE_TX))

    # PARTE 2
    E.append(Paragraph("PARTE 2 &nbsp;&mdash;&nbsp; Cargar la liquidación y vincularla a la(s) carta(s) de porte", st_h2))
    E.append(Paragraph("Qué hace el sistema al guardar la liquidación", st_h3))
    E.append(bullets([
        "<b>Descuenta el stock</b> del grano del depósito/cerealera (kilos netos a toneladas).",
        "<b>Genera la cuenta a cobrar</b> del comprador por el <b>neto a cobrar</b> (para el flujo de fondos).",
        "<b>Vincula</b> la liquidación con la(s) carta(s) de porte tildadas.",
    ]))
    E.append(Paragraph("Opción A - Importar el PDF de la liquidación (recomendado)", st_h3))
    E.append(steps([
        "Andá a <b>Stock &rarr; Liquidaciones de cereal &rarr; Importar liquidación (PDF)</b> "
        "(o desde el viaje, botón <b>&#129534;</b>).",
        "Subí el PDF de la <b>Liquidación Primaria de Granos</b>. El sistema lee número/C.O.E., fecha, comprador, "
        "grano, kilos, precio, deducciones, retenciones y el <b>neto a cobrar</b>.",
        "En la pantalla de revisión, elegí el <b>depósito/cerealera</b> y el <b>comprador</b> (o crealo), y "
        "<b>revisá el neto</b> contra el PDF.",
        "<b>Tildá la(s) carta(s) de porte</b> que cubre la liquidación (se pretildan las del mismo comprador y grano).",
        "Toca <b>Importar</b>. Queda todo cargado, vinculado y con el stock descontado.",
    ]))
    E.append(Paragraph("Opción B - Desde el viaje (a mano, con la CP ya tildada)", st_h3))
    E.append(steps([
        "En <b>Viajes</b>, en la fila de la carta de porte, toca <b>&#129534;</b>.",
        "Se abre la liquidación con esa carta de porte <b>ya tildada</b>. Completá los datos del comprobante "
        "(kilos brutos, % merma, precio $/tn y los conceptos: deducciones e impuestos/retenciones).",
        "Verificá el <b>Neto a cobrar</b> y guardá.",
    ]))
    E.append(Paragraph("Opción C - Nueva liquidación a mano", st_h3))
    E.append(steps([
        "Andá a <b>Stock &rarr; Liquidaciones de cereal &rarr; Nueva liquidación</b>.",
        "Elegí cerealera, producto, comprador y fecha; cargá kilos, precio y conceptos.",
        "<b>Tildá las cartas de porte</b> que agrupa la liquidación y toca <b>Sumar kg de las tildadas</b> "
        "para completar los kilos. Guardá.",
    ]))
    E.append(Spacer(1,4))
    E.append(Paragraph("Los tres casos habituales", st_h3))
    E.append(bullets([
        "<b>Una liquidación por una carta de porte:</b> tildás esa CP y listo.",
        "<b>Una liquidación por varias cartas de porte</b> (el acopio te liquida varios camiones juntos): "
        "tildás todas las CP que entran en esa liquidación.",
        "<b>Varias liquidaciones para una misma carta de porte</b> (parcial + final por mermas/análisis): "
        "cargás <b>cada liquidación por separado</b>, tildando siempre <b>la misma CP</b>.",
    ]))

    # PARTE 3
    E.append(Paragraph("PARTE 3 &nbsp;&mdash;&nbsp; Deducciones (flete/gastos) y cobro", st_h2))
    E.append(Paragraph("Cuando el comprador te <b>descuenta flete o gastos</b> y cobrás menos que el neto:", st_intro))
    E.append(steps([
        "Andá a <b>Comercial &rarr; Liquidaciones cereal</b> y <b>toca la fila</b> para ver el detalle.",
        "En <b>Deducciones del comprador (flete/gastos)</b> toca <b>+ Deducción</b>: cargá concepto e importe. El "
        "<b>saldo a cobrar baja a lo que realmente cobrás</b>.",
        "Si tenés la <b>factura de flete/gasto</b>, vinculala (ahora o después con &#128279; Vincular): esa factura "
        "queda <b>saldada</b> (la pagó el comprador al descontarla). Si todavía no la tenés, cargás solo el importe y la vinculás más adelante.",
        "Cobrá el resto con <b>&#128176; Registrar cobro</b>. Si cobraste en <b>dos bancos</b> (ej. el IVA en otra cuenta), "
        "usá <b>Cobrar con varios medios</b>.",
    ]))
    E.append(callout("El <b>estado</b> de la liquidación (Pendiente / Parcial / Cobrada) sale de la <b>cuenta corriente</b>, "
                     "así siempre coincide con Cuentas a cobrar. El detalle muestra cuánto cobraste en efectivo/banco, "
                     "cuánto se dedujo y el saldo. La(s) carta(s) de porte vinculada(s) pasan a &#9989; Cobrado en Viajes.",
                     BLUE_BG, BLUE_BD, BLUE_TX))

    # Estado
    E.append(Paragraph("Cómo ver el estado de cada carta de porte", st_h2))
    E.append(Paragraph("En <b>Viajes</b>, la columna <b>\"Cereal (cobro)\"</b> te muestra:", st_intro))
    E.append(bullets([
        "<b>Sin liquidar</b> - todavía no cargaste la liquidación.",
        "<b>&#129534; Liquidado</b> - ya está la liquidación, falta el cobro.",
        "<b>&#9673; Cobro parcial</b> - tiene varias liquidaciones y alguna está cobrada.",
        "<b>&#9989; Cobrado</b> - todo el cereal de esa CP ya se cobró.",
    ]))

    # FAQ
    E.append(Paragraph("Preguntas frecuentes", st_h2))
    for q,a in [
        ("¿Marcar \"pagado\" (botón verde &#128181;) es lo mismo que \"cobrado\"?",
         "No. El botón <b>&#128181;</b> es el <b>flete</b> que le pagás al camión. El <b>cobro del cereal</b> se maneja "
         "con la liquidación (botón <b>&#129534;</b> / Marcar cobrada)."),
        ("No me aparece la carta de porte para tildar.",
         "Revisá que el viaje tenga cargado el <b>destino</b> (cerealera o venta directa) o el <b>comprador</b>, y que "
         "no esté anulado."),
        ("El neto no coincide con el PDF.",
         "Revisá que hayas cargado todos los <b>conceptos</b> (deducciones e impuestos/retenciones) tal cual el "
         "comprobante. Al importar por PDF ya vienen precargados, solo confirmalos."),
        ("¿Puedo importar la liquidación aunque la carta de porte no esté cargada?",
         "Sí, pero conviene tener la CP cargada para poder <b>vincularla</b> y que el viaje quede como cobrado. "
         "Si no, cargás la liquidación igual (descuenta stock y genera la deuda) y la vinculás después."),
    ]:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))
    E.append(Spacer(1,8))
    E.append(Paragraph("Cualquier duda, escribinos por WhatsApp y lo vemos juntos.", st_intro))
    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
