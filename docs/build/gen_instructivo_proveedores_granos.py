# -*- coding: utf-8 -*-
"""Instructivo: Proveedores de granos — cuenta corriente en kilos (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Proveedores-de-Granos.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
RED_BG = colors.HexColor("#fee2e2"); RED_BD = colors.HexColor("#ef4444"); RED_TX = colors.HexColor("#991b1b")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=20, textColor=G900, spaceAfter=2, leading=24)
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

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Proveedores de granos", st_title))
    E.append(Paragraph("Llevar la cuenta de la soja en KILOS, aparte del resto de los proveedores", st_sub))
    E.append(Paragraph(
        "Los <b>proveedores de granos</b> (soja) se manejan distinto al resto: te van <b>entregando kilos</b> y después "
        "se les <b>liquida</b> (en plata o por canje). Para que no quede mezclado con los proveedores de gasoil, "
        "herramientas, etc., AgroCore tiene una pantalla aparte: <b>Comercial &rarr; Proveedores de granos</b>, con una "
        "<b>cuenta corriente en kilos</b> por cada uno. Vas viendo cuánto <b>entregó</b>, cuánto se <b>liquidó</b> y cuánto "
        "queda <b>disponible</b>, con el <b>plazo</b> de cada entrega y una <b>alarma</b> cuando se pasa la fecha de liquidar.", st_intro))
    E.append(callout("<b>La idea en una línea:</b> &nbsp; marcás al proveedor como <b>de granos</b> &rarr; cargá cada "
                     "<b>entrega</b> en kilos con su <b>plazo</b> &rarr; cuando corresponde, <b>liquidás</b> (en pesos o por "
                     "canje) y el sistema <b>descuenta esos kilos</b>.", G100, G600, G900))

    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Marcar el proveedor como “de granos”", st_h2))
    E.append(steps([
        "Andá a <b>Comercial &rarr; Proveedores</b>, abrí (o creá) el proveedor de soja (ej. Peiretti).",
        "Tildá la casilla <b>\U0001F33E Proveedor de granos</b> y guardá. Con eso queda <b>separado</b> del resto y aparece "
        "en la pantalla de granos.",
    ]))
    E.append(callout("<b>Tip:</b> solo los proveedores con esa casilla tildada aparecen en <b>Proveedores de granos</b>. "
                     "El resto (gasoil, repuestos, servicios…) sigue en Proveedores y Cuentas a pagar como siempre.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Cargar lo que va entregando (en kilos)", st_h2))
    E.append(steps([
        "Entrá a <b>Comercial &rarr; Proveedores de granos</b>. Vas a ver la lista con <b>Entregado / Liquidado / Disponible</b> por proveedor.",
        "En la fila del proveedor tocá <b>➕ Entrega</b>. Cargá los <b>kilos</b> de ese comprobante, la <b>fecha</b> y el "
        "<b>plazo para liquidar</b> (<b>Contado / 15 / 30 / 60 días</b>).",
        "Opcional: el <b>N° de comprobante</b> (remito/CP). Y si querés que esos kilos <b>entren al stock</b>, elegí el "
        "<b>grano</b> y el <b>depósito</b>; si no, solo se acumulan en la cuenta en kilos.",
        "Guardá. Los kilos se <b>suman al disponible</b> del proveedor. Cargá una entrega por cada comprobante que te traen.",
    ]))
    E.append(callout("<b>No hace falta precio.</b> La entrega es solo <b>kilos</b> (con o sin comprobante valorizado). El "
                     "precio se define recién cuando <b>liquidás</b>.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; La alarma de lo que hay que liquidar", st_h2))
    E.append(Paragraph(
        "Cada entrega tiene su <b>plazo</b>. Cuando se cumple la fecha y esos kilos <b>todavía no se liquidaron</b>, el "
        "sistema te avisa:", st_intro))
    E.append(bullets([
        "La fila del proveedor se pone en <b>rojo</b> con la marca <b>⏰ kg vencidos</b>.",
        "Arriba de la lista aparece un <b>aviso</b> con el total: “hay X kg vencidos para liquidar” y los proveedores.",
        "Se calcula por <b>orden de vencimiento</b> (las entregas más viejas primero). Por eso, aunque un proveedor tenga "
        "<b>150.000 kg</b> entregados, te muestra que (por ejemplo) <b>35.000 kg</b> ya cumplieron la fecha y hay que liquidarlos.",
    ]))
    E.append(callout("<b>Ejemplo:</b> hace 15 días entraron 35.000 kg de Peiretti con plazo de 15 días. Hoy venció y no se "
                     "liquidó: te aparece <b>Peiretti · 35.000 kg vencidos ⏰</b>.", RED_BG, RED_BD, RED_TX))

    E.append(Paragraph("PASO 4 &nbsp;&mdash;&nbsp; Liquidar: en pesos o por canje", st_h2))
    E.append(Paragraph("En la fila del proveedor tocá <b>\U0001F4B5 Liquidar</b> y elegí la forma:", st_intro))
    E.append(bullets([
        "<b>\U0001F4B5 En pesos:</b> ponés los <b>kilos a liquidar</b> y el <b>precio $/kg</b>. El sistema <b>descuenta esos "
        "kilos</b> del disponible y genera la <b>deuda en pesos</b> al proveedor (va a <b>Cuentas a pagar</b>, y la pagás "
        "como cualquier otra: efectivo, cheque, transferencia…).",
        "<b>\U0001F501 Por canje (pago con producto):</b> en vez de plata, le pagás con mercadería (ej. un camión de "
        "<b>expeller</b>). Ponés los <b>kilos de soja a liquidar</b> y elegís el <b>producto a entregar</b> con sus "
        "<b>kilos</b> (la equivalencia que pactaron). Eso <b>sale del stock</b> y <b>cancela</b> los kilos de soja.",
    ]))
    E.append(callout("<b>Ejemplo de canje:</b> se tenía que liquidar a 15 días, no se llegó, y a los 25 se pactó pagar con "
                     "un <b>camión de expeller</b>. Liquidás por canje: 35.000 kg de soja &rarr; X kg de expeller (la "
                     "equivalencia). Baja el disponible de soja y sale el expeller del stock.", BLUE_BG, BLUE_BD, BLUE_TX))
    E.append(callout("<b>No se puede liquidar de más:</b> el sistema no deja liquidar más kilos de los que hay "
                     "<b>disponibles</b>.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("PASO 5 &nbsp;&mdash;&nbsp; Ver el detalle (libro del proveedor)", st_h2))
    E.append(bullets([
        "Tocá <b>\U0001F441 Ver</b> en la fila del proveedor. Se abre su <b>libro</b> con cada movimiento.",
        "Cada <b>entrega</b> muestra su <b>vencimiento</b> y el <b>estado</b>: <b>pendiente</b>, <b>⏰ vencido</b>, "
        "<b>parcial</b> o <b>liquidado</b>.",
        "Cada <b>liquidación</b> muestra si fue en <b>pesos</b> (precio e importe) o por <b>canje</b> (producto y kilos entregados).",
        "A la derecha va el <b>saldo en kilos acumulado</b>, para ver cómo queda la cuenta después de cada movimiento.",
        "Si cargaste algo mal, podés <b>borrar</b> un movimiento (\U0001F5D1️): si había generado stock o deuda en pesos, "
        "también se revierte.",
    ]))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("¿En qué se diferencia de cargar una compra normal?",
         "La compra/factura normal es para el circuito fiscal y la deuda en pesos. Esta pantalla lleva la cuenta EN KILOS: cuánto grano entregó cada proveedor y cuánto falta liquidar. Recién al liquidar en pesos se arma la deuda a pagar."),
        ("¿Qué pasa si no le pongo precio a la entrega?",
         "Nada, es lo normal: la entrega es solo kilos. El precio se define cuando liquidás (en pesos) o se define la equivalencia (si es por canje)."),
        ("¿Puedo liquidar una parte y dejar el resto?",
         "Sí. Liquidás los kilos que quieras (hasta el disponible). El resto sigue disponible y, si tenía plazo vencido, te sigue apareciendo en la alarma."),
        ("¿La alarma me avisa sola aunque no entre a la pantalla?",
         "Por ahora la alarma se ve dentro de Proveedores de granos (fila roja + aviso arriba). El recordatorio automático en la agenda/notificaciones queda para una próxima mejora."),
        ("¿El canje de granos tiene relación con el módulo de Canje de la fábrica?",
         "Son cosas distintas. Acá el 'canje' es una forma de LIQUIDAR al proveedor de granos pagando con producto. El módulo Canje (grano) de la fábrica es para operaciones de canje producto<->grano con paridad; no se mezclan."),
        ("¿Si borro una liquidación, se deshace la deuda o la salida de stock?",
         "Sí. Al borrar el movimiento se revierte lo que haya generado: la deuda en pesos (Cuentas a pagar) o la salida de stock del producto entregado por canje."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
