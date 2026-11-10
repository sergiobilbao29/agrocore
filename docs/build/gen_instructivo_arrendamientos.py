# -*- coding: utf-8 -*-
"""Instructivo: Manejo completo de Arrendamientos en AgroCore (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Arrendamientos.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
IND_BG = colors.HexColor("#e0e7ff"); IND_BD = colors.HexColor("#818cf8"); IND_TX = colors.HexColor("#3730a3")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=20, textColor=G900, spaceAfter=2, leading=24)
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
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazon del negocio agricola")
    canvas.drawRightString(w-15*mm, 10*mm, "Pagina %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Manejo completo de Arrendamientos", st_title))
    E.append(Paragraph("Cargar el contrato, elegir la modalidad y pagar: efectivo, quintales, Kg Novillo, porcentaje y kilos a pizarra", st_sub))
    E.append(Paragraph(
        "En <b>Finanzas &rarr; Arrendamientos</b> cargas cada contrato de alquiler de campo con su <b>propietario</b>, las "
        "<b>hectareas</b> y la <b>modalidad de pago</b>. Segun la modalidad, el sistema valoriza lo que hay que pagar (a la "
        "cotizacion del dia) y te deja ir registrando los pagos, que quedan reflejados en <b>Movimientos diarios</b> y en el "
        "<b>Flujo de Fondos</b>. Hay cinco modalidades; abajo se explican todas, con foco en la de <b>kilos de grano con venta "
        "mensual a precio pizarra</b>.", st_intro))
    E.append(callout("<b>Dato clave:</b> &nbsp; cada contrato tiene UNA modalidad. Elegila bien al cargarlo; podes editarla despues, "
                     "pero conviene arrancar con la correcta para que las cuotas/ventas queden prolijas.", G100, G600, G900))

    E.append(Paragraph("Las 5 modalidades de pago", st_h2))
    data = [
        [Paragraph("<b>Modalidad</b>", st_step), Paragraph("<b>Cuando usarla</b>", st_step)],
        [Paragraph("<b>Efectivo ($/ha)</b>", st_step), Paragraph("Monto fijo por hectarea, en pesos o dolares. Con o sin cuotas.", st_step)],
        [Paragraph("<b>Quintales de grano</b>", st_step), Paragraph("En especie: qq/ha en blanco y en negro. Se valoriza a pizarra del grano.", st_step)],
        [Paragraph("<b>Kg Novillo</b>", st_step), Paragraph("Kg de novillo por ha. Se valoriza al precio Canuelas cargado en Cotizaciones.", st_step)],
        [Paragraph("<b>Porcentaje del rinde</b>", st_step), Paragraph("Un % de lo cosechado. Sin cuotas (depende del rinde real).", st_step)],
        [Paragraph("<b>Kilos de grano (venta mensual a pizarra)</b>", st_step), Paragraph("Total en kilos que el dueno va vendiendo por mes; cada venta se paga a pizarra del dia, en entregas.", st_step)],
    ]
    t = Table(data, colWidths=[55*mm, 110*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),G100),("BOX",(0,0),(-1,-1),0.6,G600),
        ("INNERGRID",(0,0),(-1,-1),0.4,colors.HexColor("#bbf7d0")),
        ("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
    E.append(t)

    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Cargar el contrato", st_h2))
    E.append(steps([
        "Entra a <b>Finanzas &rarr; Arrendamientos</b> y toca <b>+ Nuevo arrendamiento</b>.",
        "Pone el <b>Nombre del contrato</b> (ej. &ldquo;Campo Norte - Perez 2026/27&rdquo;), el <b>Propietario</b> y, si queres, asocia un <b>Campo</b>.",
        "Carga las <b>Hectareas</b> y elegi la <b>Modalidad de pago</b>.",
        "Completa los campos que aparecen segun la modalidad (importe/ha, qq/ha, etc.) y, si corresponde, las <b>cuotas</b> (cuanto y cuando).",
        "Guarda. En la lista veras el contrato con su valor estimado a la cotizacion de hoy.",
    ]))

    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Pagar las cuotas (efectivo, quintales, Kg Novillo)", st_h2))
    E.append(steps([
        "En la lista, toca el boton <b>&#128197; (cuotas)</b> del contrato.",
        "En cada cuota toca <b>Pagar</b>: el sistema trae el <b>monto estimado</b> a la cotizacion del dia (editalo si el pago real difiere).",
        "Elegi el <b>metodo</b>: efectivo, cheque, transferencia, debito o tarjeta, y la caja/cuenta/cheque segun corresponda.",
        "Confirma. La cuota queda <b>pagada</b> y el egreso se registra en <b>Movimientos diarios</b> (mueve la caja/banco/cheque real).",
    ]))
    E.append(callout("<b>Flujo de Fondos:</b> cada cuota de arrendamiento aparece <b>valorizada</b> en su fecha de vencimiento "
                     "(quintales a pizarra, Kg Novillo a Canuelas, efectivo por su moneda), asi planificas los pagos.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Modalidad KILOS DE GRANO (venta mensual a pizarra)", st_h2))
    E.append(Paragraph(
        "Es el caso del arreglo tipo: un total en kilos de soja que el dueno <b>va vendiendo por mes</b>, y el dia que vende se "
        "mira el <b>precio pizarra</b> y se calcula cuanto pagarle. Ademas, ese pago no se hace de una sola vez: se hacen "
        "<b>varias entregas</b> sobre cada venta.", st_intro))

    E.append(Paragraph("3.1 &nbsp; Cargar el contrato en kilos", st_h3))
    E.append(steps([
        "Al crear el arrendamiento, en <b>Modalidad</b> elegi <b>&ldquo;Kilos de grano (venta mensual a pizarra)&rdquo;</b>.",
        "Carga el <b>Grano</b> (ej. Soja), los <b>Kilos totales</b> del contrato (ej. 115.200), los <b>Kilos por mes</b> que vende segun el arreglo (ej. 9.600) y el <b>Mes de inicio</b>.",
        "Guarda. El sistema <b>arma solo el plan de meses</b> (cada mes con sus kilos) y te abre la pantalla de <b>Ventas</b>.",
    ]))
    E.append(callout("<b>Plan vs. real:</b> el plan usa los kilos del arreglo (9.600). Si el dueno en realidad vende otra cantidad "
                     "(ej. 10.000), lo ajustas en la venta de ese mes. El plan es solo la guia.", G100, G600, G900))

    E.append(Paragraph("3.2 &nbsp; Registrar cada venta a pizarra", st_h3))
    E.append(steps([
        "En la lista del contrato, toca <b>&#127807; Ventas</b>.",
        "Veras una fila por mes. Cuando el dueno vende, en ese mes carga los <b>Kilos reales</b> vendidos y el <b>Precio pizarra ($/tonelada)</b> del dia, y la <b>fecha de venta</b>.",
        "Toca <b>&#128190; (guardar)</b> de esa fila. El sistema calcula el <b>importe a pagar</b> = kilos / 1000 &times; precio pizarra, y la venta pasa a <b>&ldquo;vendida - a pagar&rdquo;</b>.",
    ]))
    E.append(callout("<b>Ojo con la unidad:</b> la pizarra se carga en <b>pesos por TONELADA</b> (como figura en el ticker, ej. $535.000/t). "
                     "El sistema convierte los kilos a toneladas solo.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("3.3 &nbsp; Ir anotando las entregas (pagos parciales)", st_h3))
    E.append(steps([
        "En la fila de una venta ya valorizada, toca <b>&#128181; Entrega</b>.",
        "Carga el <b>importe de esa entrega ($)</b> y, si queres, los <b>kilos entregados</b> (dato informativo) de ese pago.",
        "Elegi el <b>metodo de pago</b> (efectivo, cheque, transferencia, debito, tarjeta) y la caja/cuenta/cheque.",
        "Registra. La entrega <b>mueve la plata</b> a Movimientos diarios y <b>descuenta del saldo</b> de la venta. Repeti hasta saldar: cuando el saldo llega a 0, la venta queda <b>pagada</b>.",
    ]))
    E.append(callout("<b>Ejemplo:</b> vendio 10.000 kg a $500.000/t = $5.000.000 a pagar. Le haces 3 entregas (ej. $2.000.000 + $2.000.000 + "
                     "$1.000.000) y en cada una podes anotar los kilos que le entregaste. El sistema lleva el saldo hasta que queda en cero.", IND_BG, IND_BD, IND_TX))
    E.append(bullets([
        "Cada entrega queda listada debajo de su venta, con fecha, metodo, importe y kilos.",
        "Si te equivocaste, toca <b>deshacer</b> en la entrega: revierte el movimiento de plata y vuelve a sumar el saldo.",
        "Abajo de la tabla ves los <b>totales</b>: kilos, total a pagar y saldo pendiente de todo el contrato.",
    ]))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("Puedo editar los kilos o el precio de una venta despues?",
         "Si. Entra a Ventas, cambia el valor y toca guardar en esa fila. El importe y el saldo se recalculan solos."),
        ("Que pasa si un mes no vende?",
         "Dejas esa fila sin precio (queda 'pendiente'). Cuando venda, cargas kilos y pizarra. No estas obligada a usar todos los meses del plan."),
        ("La entrega se anota en pesos o en kilos?",
         "La entrega es un importe en pesos (lo que realmente le pagas). Ademas podes anotar los kilos entregados como dato informativo, para tu control."),
        ("Las entregas afectan la caja o el banco?",
         "Si. Cada entrega genera el egreso real en Movimientos diarios segun el metodo (efectivo/cheque/banco). Por eso el saldo del sistema queda siempre al dia."),
        ("Puedo tener este contrato y otros con otra modalidad al mismo tiempo?",
         "Si. Cada contrato es independiente. Uno puede ser en kilos a pizarra, otro en quintales y otro en efectivo."),
        ("Donde veo cuanto le pague en total a un propietario?",
         "En la pantalla de Ventas del contrato: el pie de tabla muestra total a pagar y saldo. Cada egreso tambien queda en Movimientos diarios por fecha."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
