# -*- coding: utf-8 -*-
"""Instructivo: Ordenes de Trabajo (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Ordenes-de-Trabajo.pdf")
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
    E.append(Paragraph("Órdenes de trabajo", st_title))
    E.append(Paragraph("Indicarle al contratista qué labor hacer y qué insumos usar, y después facturar el servicio", st_sub))
    E.append(Paragraph(
        "Una <b>orden de trabajo</b> (OT) es el documento que le entregás al <b>contratista</b> (el que te hace "
        "la labor: pulverización, siembra, cosecha, etc.) con el detalle de <b>qué labor realizar</b>, sobre "
        "<b>qué campo/lote y campaña</b>, en <b>qué fecha</b> y con <b>qué insumos</b> (producto, dosis por "
        "hectárea y total a aplicar). La OT sale <b>sin precios</b>: el costo recién aparece cuando cargás la "
        "factura del contratista. Está en <b>Producción &rarr; Órdenes de trabajo</b>.", st_intro))
    E.append(callout("<b>La OT en 3 estados:</b> &nbsp; <b>Pendiente</b> (todavía no se hizo) &rarr; "
                     "<b>Realizada</b> (se concretó; opcionalmente descuenta los insumos del stock) &rarr; "
                     "<b>Facturada</b> (cargaste la factura del contratista, que genera la deuda en el proveedor).",
                     G100, G600, G900))
    E.append(Spacer(1, 3))

    E.append(Paragraph("Dónde se hace", st_h2))
    E.append(Paragraph("Menú <b>Producción &rarr; Órdenes de trabajo</b> (justo arriba de <b>Insumos y labores</b>).", st_intro))

    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Crear la orden", st_h2))
    E.append(steps([
        "Tocá <b>&#65291; Nueva orden</b>.",
        "Elegí la <b>fecha de emisión</b> y, si ya la sabés, la <b>fecha de la labor</b> (el día en que el contratista va a trabajar).",
        "Elegí el <b>contratista</b> (se toma de tu lista de proveedores; si no está, lo podés dar de alta).",
        "Agregá uno o varios <b>renglones de labor</b>: en cada uno indicás <b>campaña</b>, <b>campo</b>, <b>lote</b>, "
        "<b>cultivo</b>, <b>hectáreas</b> y el <b>nombre de la labor</b>.",
        "Dentro de cada renglón, cargás los <b>insumos a aplicar</b>: elegís el producto, la <b>dosis por hectárea</b> "
        "y el sistema calcula el <b>total</b> (o lo escribís a mano).",
        "Si querés, sumás <b>observaciones</b> para el contratista (indicaciones, cuidados, horario). <b>Guardar</b>.",
    ]))
    E.append(callout("<b>Sin precios, a propósito:</b> la OT es una instrucción de trabajo, no un presupuesto. Por eso "
                     "no muestra importes. El costo del servicio se carga después, con la factura del contratista.",
                     BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Entregársela al contratista", st_h2))
    E.append(Paragraph("Con la orden creada, tenés dos formas de hacérsela llegar:", st_intro))
    E.append(bullets([
        "<b>&#128424;&#65039; Imprimir / ver</b>: abre la OT en formato documento (hoja A4 apaisada) con el logo "
        "de AgroCore, lista para <b>imprimir y entregar en mano</b> o <b>guardar como PDF</b> (desde el diálogo de "
        "impresión, elegí &ldquo;Guardar como PDF&rdquo;) y mandarla por mail.",
        "<b>&#128172; WhatsApp</b>: arma un mensaje prolijo con el detalle de la labor y los insumos y lo abre en "
        "WhatsApp hacia el teléfono del contratista, listo para enviar.",
    ]))
    E.append(callout("La impresión incluye una <b>&ldquo;Provisión de insumos&rdquo;</b> (el total de cada producto "
                     "sumando todos los renglones) y un pie de <b>firmas</b> (Entregó / Recibió) para dejar "
                     "constancia de la entrega.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Marcarla realizada", st_h2))
    E.append(Paragraph("Cuando el contratista <b>terminó la labor</b>, abrís la orden y tocá <b>&#9989; Realizada</b>. "
                       "Ahí podés elegir si <b>descontar los insumos del stock</b> (salida del depósito que indiques) "
                       "o solo cambiar el estado sin tocar stock.", st_intro))
    E.append(bullets([
        "Si <b>descontás del stock</b>: por cada insumo se genera una salida del depósito elegido (queda registrado el movimiento).",
        "Si te equivocaste, con <b>&#8617;&#65039; Volver a pendiente</b> se revierte el estado (y la salida de stock, si la había).",
    ]))

    E.append(Paragraph("PASO 4 &nbsp;&mdash;&nbsp; Facturar el servicio (cargar la factura del contratista)", st_h2))
    E.append(Paragraph("Con la orden en <b>Realizada</b>, cuando llega la <b>factura del contratista</b> la cargás "
                       "desde la misma OT con el botón <b>&#129534; Facturar</b>:", st_intro))
    E.append(steps([
        "Tocá <b>&#129534; Facturar</b> en la fila de la orden.",
        "Se abre el alta de <b>factura de compra</b> ya con el proveedor cargado; completás número, fecha, importe e IVA.",
        "Al guardar, la factura <b>genera la deuda en el proveedor</b> (cuenta a pagar) y la OT pasa a <b>Facturada</b>, "
        "quedando vinculada a esa factura.",
        "Si cargaste mal, con <b>&#8617;&#65039; Quitar factura</b> desvinculás la factura y la OT vuelve a Realizada.",
    ]))
    E.append(callout("<b>Así se arma el costo:</b> la labor que indicaste en la OT queda unida a la factura real del "
                     "contratista. De ese modo el gasto del servicio impacta en el proveedor y en tus costos, con la "
                     "trazabilidad de qué labor fue.", G100, G600, G900))

    E.append(Paragraph("Fechas, filtros y calendario", st_h2))
    E.append(bullets([
        "En el <b>listado</b> ves cada OT con su <b>N&deg;</b>, la fecha de <b>emisión</b>, la <b>fecha de la labor</b>, "
        "el contratista, las labores y el estado.",
        "Podés <b>filtrar</b> por estado, contratista, campaña y por <b>fecha desde / hasta</b>.",
        "Las OT <b>pendientes con fecha de labor</b> aparecen en el <b>Calendario / Agenda</b> y te <b>avisan 3 días antes</b>, "
        "para que no se te pase coordinar el trabajo.",
    ]))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("¿Puedo poner precios en la orden?",
         "No: la OT es la instrucción de trabajo y sale sin importes. El costo se carga después con la factura del contratista (botón Facturar)."),
        ("¿El contratista tiene que estar como proveedor?",
         "Sí. El contratista se elige de tu lista de proveedores. Si todavía no lo tenés, lo das de alta y después lo seleccionás en la orden."),
        ("¿Marcar realizada siempre descuenta el stock?",
         "No, es opcional. Al marcar Realizada elegís si descontar los insumos del depósito o solo cambiar el estado. Si lo descontás, podés revertirlo volviendo la orden a pendiente."),
        ("¿Qué pasa si todavía no tengo la factura del contratista?",
         "Dejás la orden en Realizada. Cuando llegue la factura, la cargás desde la OT con Facturar y ahí se genera la deuda en el proveedor."),
        ("¿Puedo cargar varias labores en una sola orden?",
         "Sí. Una OT puede tener varios renglones (cada uno con su campo/lote, hectáreas, labor e insumos). Todos salen en el mismo documento."),
        ("¿Cómo se la mando al contratista si está en el campo?",
         "Con el botón WhatsApp le llega el detalle al teléfono, o con Imprimir / ver la guardás como PDF y la mandás por mail, o la imprimís para entregar en mano."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
